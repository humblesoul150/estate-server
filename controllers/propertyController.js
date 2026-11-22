const mongoose = require("mongoose");
const { Readable } = require("stream");
const logger = require("../configs/logger");
const Property = require("../models/property");
const Listing = require("../models/listing");
const Users = require("../models/user");
const bcrypt = require("bcryptjs");
const cloudinary = require("../configs/cloudinary");
const SUPPORTED_CURRENCIES = require("../utils/currencies");

const uploadImage = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "estate/properties", resource_type: "image" },
      (error, result) => {
        if (error) return reject(error);
        return resolve(result);
      },
    );
    Readable.from(file.buffer).pipe(stream);
  });

const persistImages = async (images = [], files = [], preserveExisting = false) =>
  Promise.all(
    images.map(async (image) => {
      if (
        preserveExisting &&
        image?.uploadIndex === undefined &&
        typeof image?.url === "string" &&
        /^https?:\/\//i.test(image.url)
      ) {
        return {
          title: image.title || "Property image",
          url: image.url,
          publicId: image.publicId ?? image.public_id,
        };
      }

      const file = files[Number(image.uploadIndex)];
      if (!file) {
        throw new Error("An uploaded property image is missing.");
      }
      const uploaded = await uploadImage(file);
      return {
        title: image.title || "Property image",
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
      };
    }),
  );

const serializeMarketplaceProperty = (property) => property.toJSON();

const createMarketplaceProperty = async (req, res) => {
  let property;
  try {
    let payload = req.body?.payload;
    if (typeof payload === "string") payload = JSON.parse(payload);
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ message: "A property payload is required." });
    }
    const listingCurrency =
      typeof payload.listing?.currency === "string"
        ? payload.listing.currency.trim().toUpperCase()
        : "";
    if (
      !payload.name?.trim() ||
      !payload.description?.trim() ||
      !payload.address?.trim() ||
      !payload.city?.trim() ||
      !payload.country?.trim() ||
      !payload.listing ||
      !["rent", "sale"].includes(payload.listing.purpose) ||
      !Number.isFinite(Number(payload.listing.price)) ||
      Number(payload.listing.price) < 0 ||
      !listingCurrency
    ) {
      return res.status(400).json({ message: "The property or listing details are invalid." });
    }
    if (!SUPPORTED_CURRENCIES.includes(listingCurrency)) {
      return res.status(400).json({ message: "Please choose a supported currency." });
    }

    const files = req.files || [];
    const images = await persistImages(Array.isArray(payload.images) ? payload.images : [], files);
    const units = await Promise.all(
      (payload.units || []).map(async (unit) => ({
        ...unit,
        images: await persistImages(
          Array.isArray(unit.images) ? unit.images : [],
          files,
        ),
      })),
    );
    property = await Property.create({
      name: payload.name.trim(),
      address: payload.address.trim(),
      city: payload.city.trim(),
      country: payload.country.trim(),
      category: payload.category,
      estate: payload.estate,
      propertyType: payload.propertyType,
      description: payload.description.trim(),
      location: payload.location,
      images,
      features: payload.features || [],
      specifications: payload.specifications || [],
      policies: payload.policies,
      units,
      units_available: units.filter((unit) => unit.isAvailable !== false).length,
      customizeUnits: units.length > 1,
      price_per_unit: Number(payload.listing.price),
      ownerId: req.user.userId,
      moderationStatus: "pending",
    });

    let listing;
    try {
      listing = await Listing.create({
        propertyId: property._id,
        purpose: payload.listing.purpose,
        status: "draft",
        price: Number(payload.listing.price),
        currency: listingCurrency,
        billingPeriod:
          payload.listing.purpose === "sale"
            ? "one-time"
            : payload.listing.billingPeriod,
        serviceFee:
          payload.listing.serviceFee === "" || payload.listing.serviceFee == null
            ? undefined
            : Number(payload.listing.serviceFee),
        negotiable: Boolean(payload.listing.negotiable),
        availableFrom: payload.listing.availableFrom,
      });
    } catch (error) {
      await Property.deleteOne({ _id: property._id });
      throw error;
    }

    return res.status(201).json({
      success: true,
      property: {
        ...serializeMarketplaceProperty(property),
        listings: [listing.toJSON()],
      },
    });
  } catch (error) {
    logger.error("Marketplace property creation failed", {
      message: error.message,
      userId: req.user?.userId,
    });
    return res.status(500).json({
      message: error.message || "Unable to create marketplace property.",
    });
  }
};

const getMarketplaceProperties = async (_req, res) => {
  try {
    const properties = await Property.find({ moderationStatus: "approved" })
      .populate({ path: "listings", match: { status: "published" } })
      .sort({ createdAt: -1 });
    return res.status(200).json({
      properties: properties
        .map(serializeMarketplaceProperty)
        .filter((property) => property.listings.length > 0),
    });
  } catch (error) {
    logger.error("Marketplace properties could not be loaded", {
      message: error.message,
    });
    return res.status(500).json({ message: "Unable to load marketplace properties." });
  }
};

const getMarketplacePropertiesForReview = async (_req, res) => {
  try {
    const properties = await Property.find({})
      .populate("listings")
      .sort({ createdAt: -1 });
    return res.status(200).json({
      properties: properties.map(serializeMarketplaceProperty),
    });
  } catch (error) {
    logger.error("Marketplace review properties could not be loaded", {
      message: error.message,
    });
    return res.status(500).json({ message: "Unable to load properties for review." });
  }
};

const moderateMarketplaceProperty = async (req, res) => {
  try {
    const { status, reason } = req.body || {};
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid moderation status." });
    }
    const property = await Property.findById(req.params.propertyId);
    if (!property) {
      return res.status(404).json({ message: "Property not found." });
    }

    const listingStatus =
      status === "approved" ? "published" : status === "rejected" ? "paused" : "draft";
    await Listing.updateMany(
      { propertyId: property._id },
      {
        $set: {
          status: listingStatus,
          ...(status === "approved" ? { publishedAt: new Date() } : {}),
        },
      },
    );
    property.moderationStatus = status;
    property.moderationReason = status === "rejected" ? reason?.trim() : undefined;
    await property.save();

    const updated = await Property.findById(property._id).populate("listings");
    return res.status(200).json({
      success: true,
      property: serializeMarketplaceProperty(updated),
    });
  } catch (error) {
    logger.error("Marketplace moderation failed", {
      message: error.message,
      propertyId: req.params.propertyId,
    });
    return res.status(500).json({ message: "Unable to update property moderation." });
  }
};

const updateMarketplaceProperty = async (req, res) => {
  try {
    const property = await Property.findById(req.params.propertyId);
    if (!property) {
      return res.status(404).json({ message: "Property not found." });
    }
    let payload = req.body?.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return res.status(400).json({ message: "The property payload is invalid." });
      }
    }
    payload = payload || req.body || {};
    const propertyUpdates = payload.property || payload;
    const listingUpdates = payload.listing || {};
    const allowedListingFields = [
      "purpose",
      "price",
      "currency",
      "billingPeriod",
      "serviceFee",
      "negotiable",
      "availableFrom",
    ];
    const listingUpdate = {};
    allowedListingFields.forEach((field) => {
      if (listingUpdates[field] !== undefined) {
        listingUpdate[field] = listingUpdates[field];
      }
    });
    if (listingUpdate.currency !== undefined) {
      if (typeof listingUpdate.currency !== "string") {
        return res.status(400).json({ message: "Please choose a supported currency." });
      }
      listingUpdate.currency = listingUpdate.currency.trim().toUpperCase();
      if (!SUPPORTED_CURRENCIES.includes(listingUpdate.currency)) {
        return res.status(400).json({ message: "Please choose a supported currency." });
      }
    }
    if (
      listingUpdate.price !== undefined &&
      (!Number.isFinite(Number(listingUpdate.price)) ||
        Number(listingUpdate.price) < 0)
    ) {
      return res.status(400).json({ message: "Listing price must not be negative." });
    }
    if (
      listingUpdate.serviceFee !== undefined &&
      listingUpdate.serviceFee !== null &&
      (!Number.isFinite(Number(listingUpdate.serviceFee)) ||
        Number(listingUpdate.serviceFee) < 0)
    ) {
      return res.status(400).json({ message: "Service fee must not be negative." });
    }
    if (
      listingUpdate.purpose !== undefined &&
      !["rent", "sale"].includes(listingUpdate.purpose)
    ) {
      return res.status(400).json({ message: "Please choose a valid listing purpose." });
    }
    const listingId = payload.listingId;
    if (Object.keys(listingUpdate).length) {
      if (!mongoose.isValidObjectId(listingId)) {
        return res.status(400).json({ message: "A valid listingId is required." });
      }
      const existingListing = await Listing.findOne({
        _id: listingId,
        propertyId: property._id,
      });
      if (!existingListing) {
        return res.status(404).json({ message: "Listing not found for this property." });
      }
    }
    const stringFields = [
      "name",
      "address",
      "city",
      "country",
      "category",
      "estate",
      "propertyType",
      "description",
    ];
    for (const field of stringFields) {
      if (
        propertyUpdates[field] !== undefined &&
        typeof propertyUpdates[field] !== "string"
      ) {
        return res.status(400).json({ message: `${field} must be a string.` });
      }
    }
    const allowedPropertyFields = stringFields;
    allowedPropertyFields.forEach((field) => {
      if (propertyUpdates[field] !== undefined) {
        property[field] = propertyUpdates[field].trim();
      }
    });
    if (propertyUpdates.location !== undefined) {
      const { lat, lng } = propertyUpdates.location || {};
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return res.status(400).json({ message: "A valid property location is required." });
      }
      property.location = { lat: Number(lat), lng: Number(lng) };
    }
    for (const field of ["features", "specifications", "units", "images"]) {
      if (
        propertyUpdates[field] !== undefined &&
        !Array.isArray(propertyUpdates[field])
      ) {
        return res.status(400).json({ message: `${field} must be a list.` });
      }
    }
    if (
      propertyUpdates.policies !== undefined &&
      (!propertyUpdates.policies ||
        typeof propertyUpdates.policies !== "object" ||
        Array.isArray(propertyUpdates.policies))
    ) {
      return res.status(400).json({ message: "Property policies are invalid." });
    }
    if (propertyUpdates.features !== undefined) {
      property.features = propertyUpdates.features;
    }
    if (propertyUpdates.specifications !== undefined) {
      property.specifications = propertyUpdates.specifications;
    }
    if (propertyUpdates.policies !== undefined) {
      property.policies = propertyUpdates.policies;
    }
    if (propertyUpdates.units !== undefined) {
      const files = req.files || [];
      property.units = await Promise.all(
        propertyUpdates.units.map(async (unit) => ({
          ...unit,
          images: await persistImages(
            Array.isArray(unit.images) ? unit.images : [],
            files,
            true,
          ),
        })),
      );
      property.units_available = property.units.filter(
        (unit) => unit.isAvailable !== false,
      ).length;
      property.customizeUnits = property.units.length > 1;
    }
    if (propertyUpdates.images !== undefined) {
      property.images = await persistImages(
        propertyUpdates.images,
        req.files || [],
        true,
      );
    }
    if (listingUpdate.serviceFee !== undefined) {
      listingUpdate.serviceFee =
        listingUpdate.serviceFee === null
          ? null
          : Number(listingUpdate.serviceFee);
      property.serviceFee = listingUpdate.serviceFee;
    }
    await property.save();

    if (listingUpdate.price !== undefined) {
      listingUpdate.price = Number(listingUpdate.price);
      property.price_per_unit = listingUpdate.price;
      await property.save();
    }
    if (Object.keys(listingUpdate).length) {
      const updatedListing = await Listing.findOneAndUpdate(
        { _id: listingId, propertyId: property._id },
        { $set: listingUpdate },
        { new: true, runValidators: true },
      );
      if (!updatedListing) {
        return res.status(404).json({ message: "Listing not found for this property." });
      }
    }

    const updated = await Property.findById(property._id).populate("listings");
    return res.status(200).json({
      success: true,
      property: serializeMarketplaceProperty(updated),
    });
  } catch (error) {
    logger.error("Marketplace property update failed", {
      message: error.message,
      propertyId: req.params.propertyId,
    });
    return res.status(500).json({ message: "Unable to update marketplace property." });
  }
};

const deleteMarketplaceProperty = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { currentPassword } = req.body || {};

    if (!mongoose.isValidObjectId(propertyId)) {
      return res.status(400).json({ message: "A valid property id is required." });
    }
    if (typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ message: "Your current password is required." });
    }

    const user = await Users.findById(req.user.userId).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(403).json({ message: "Current password is incorrect." });
    }

    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({ message: "Property not found." });
    }

    const listingDeleteResult = await Listing.deleteMany({ propertyId: property._id });
    await Property.deleteOne({ _id: property._id });

    return res.status(200).json({
      success: true,
      message: "Property deleted successfully.",
      deletedListings: listingDeleteResult.deletedCount || 0,
    });
  } catch (error) {
    logger.error("Marketplace property delete failed", {
      message: error.message,
      propertyId: req.params.propertyId,
    });
    return res.status(500).json({ message: "Unable to delete marketplace property." });
  }
};

exports.createProperty = async (req, res) => {
  try {
    const data = req.body || {};
    const findExisting = await Property.findOne({
      name: data.name,
      location: data.location,
    });

    if (findExisting) {
      return res.status(400).json({
        message: "Another property with this name or Location already exists!",
      });
    }

    const newProperty = new Property({ ...data });

    await newProperty.save();

    const newStructure = {
      ...newProperty,
      id: newProperty._id,
    };

    res.status(201).json({
      success: "ok",
      messages: "New Property profile has been created",
      property: newStructure,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: `Failed to create property profile for ${req.body.name}`,
    });
  }
};

exports.getAllProperties = async (req, res) => {
  try {
    const getAllListings = await Property.find({ listings: { $exists: true } })
      .populate("listings")
      .lean();
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to get property profiles!" });
  }
};

module.exports = {
  createMarketplaceProperty,
  getMarketplaceProperties,
  getMarketplacePropertiesForReview,
  moderateMarketplaceProperty,
  updateMarketplaceProperty,
  deleteMarketplaceProperty,
};
