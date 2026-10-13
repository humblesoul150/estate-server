const axios = require("axios");
const logger = require("../configs/logger");
const Property = require("../models/property");
const Listings = require("../models/listing");

const PROPERTY_SOURCE_URL =
  process.env.PROPERTY_SOURCE_URL ||
  "https://tenant-server-dct1.onrender.com/api/property/all";
const PROPERTY_SOURCE_TIMEOUT_MS = Number(
  process.env.PROPERTY_SOURCE_TIMEOUT_MS || 8000,
);

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

module.exports = { getProperties };
