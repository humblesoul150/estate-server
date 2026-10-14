const axios = require("axios");
const mongoose = require("mongoose");
const { Readable } = require("stream");
const logger = require("../configs/logger");
const Property = require("../models/property");
const Listing = require("../models/listing");
const cloudinary = require("../configs/cloudinary");

const PROPERTY_SOURCE_URL =
  process.env.PROPERTY_SOURCE_URL ||
  "https://tenant-server-dct1.onrender.com/api/property/all";
const PROPERTY_SOURCE_TIMEOUT_MS = Number(
  process.env.PROPERTY_SOURCE_TIMEOUT_MS || 8000,
);

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

const persistImages = async (images = [], files = []) =>
  Promise.all(
    images.map(async (image) => {
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

const getProperties = async (req, res) => {
  try {
    const response = await axios.get(PROPERTY_SOURCE_URL, {
      timeout: PROPERTY_SOURCE_TIMEOUT_MS,
      headers: { Accept: "application/json" },
    });
    if (
      !response.data ||
      typeof response.data !== "object" ||
      !Array.isArray(response.data.properties)
    ) {
      logger.warn("Property source returned an invalid response shape");
      return res.status(502).json({
        message: "Property data source returned an invalid response",
      });
    }

    return res.status(200).json({ properties: response.data.properties });
  } catch (error) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      logger.warn("Property source request timed out", {
        code: error.code,
      });
      return res.status(504).json({
        message: "Property data source timed out",
      });
    }

    logger.error("Property source request failed", {
      message: error.message,
      status: error.response?.status,
    });
    return res.status(502).json({
      message: "Unable to retrieve properties",
    });
  }
};

const createMarketplaceProperty = async (req, res) => {
  let property;
  try {
    let payload = req.body?.payload;
    if (typeof payload === "string") payload = JSON.parse(payload);
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ message: "A property payload is required." });
    }
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
      !payload.listing.currency?.trim()
    ) {
      return res.status(400).json({ message: "The property or listing details are invalid." });
    }

    const files = req.files || [];
    const images = await persistImages(payload.images, files);
    const units = await Promise.all(
      (payload.units || []).map(async (unit) => ({
        ...unit,
        images: await persistImages(unit.images, files),
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
        currency: payload.listing.currency.trim(),
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
    const propertyUpdates = req.body?.property || {};
    const listingUpdates = req.body?.listing || {};
    const allowedListingFields = ["price", "currency", "negotiable", "availableFrom"];
    const listingUpdate = {};
    allowedListingFields.forEach((field) => {
      if (listingUpdates[field] !== undefined) {
        listingUpdate[field] = listingUpdates[field];
      }
    });
    if (listingUpdate.price !== undefined && Number(listingUpdate.price) < 0) {
      return res.status(400).json({ message: "Listing price must not be negative." });
    }
    const listingId = req.body?.listingId;
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
    const allowedPropertyFields = ["name", "description"];
    allowedPropertyFields.forEach((field) => {
      if (typeof propertyUpdates[field] === "string") {
        property[field] = propertyUpdates[field].trim();
      }
    });
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

    if (!mongoose.isValidObjectId(propertyId)) {
      return res.status(400).json({ message: "A valid property id is required." });
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
  getProperties,
  createMarketplaceProperty,
  getMarketplaceProperties,
  getMarketplacePropertiesForReview,
  moderateMarketplaceProperty,
  updateMarketplaceProperty,
  deleteMarketplaceProperty,
};
