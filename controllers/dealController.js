const mongoose = require("mongoose");
const Deal = require("../models/deal");
const Property = require("../models/property");
const Listing = require("../models/listing");

function calculateDiscountPrice(basePrice, discountType, value) {
  if (!Number.isFinite(Number(basePrice)) || Number(basePrice) < 0) {
    throw new Error("The base price must be a valid non-negative number.");
  }

  if (!discountType || !["percentage", "fixed"].includes(discountType)) {
    throw new Error("Discount type must be either percentage or fixed.");
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error("The discount value must be a valid non-negative number.");
  }

  if (discountType === "percentage") {
    if (numericValue >= 100) {
      throw new Error("Percentage discounts must be less than 100%.");
    }
    return Number((basePrice * (1 - numericValue / 100)).toFixed(2));
  }

  if (numericValue >= basePrice) {
    throw new Error("Fixed discounts must be less than the base price.");
  }

  return Number((basePrice - numericValue).toFixed(2));
}

function normalizeDealStatus(dealOrStatus, currentDate = new Date()) {
  if (dealOrStatus && typeof dealOrStatus === "object") {
    const deal = dealOrStatus;
    if (deal.status === "removed") return "removed";
    if (deal.status !== "published") return deal.status;

    const now = currentDate instanceof Date ? currentDate : new Date(currentDate);
    const startsAt = deal.startsAt ? new Date(deal.startsAt) : null;
    const endsAt = deal.endsAt ? new Date(deal.endsAt) : null;

    if (startsAt && !Number.isNaN(startsAt.getTime()) && now < startsAt) {
      return "scheduled";
    }
    if (endsAt && !Number.isNaN(endsAt.getTime()) && now > endsAt) {
      return "expired";
    }
    return "active";
  }

  if (dealOrStatus === "removed") return "removed";
  if (dealOrStatus !== "published") return dealOrStatus;
  return "active";
}

function isDealActive(deal, currentDate = new Date()) {
  const normalizedStatus = normalizeDealStatus(deal, currentDate);
  return normalizedStatus === "active";
}

function serializeDeal(deal) {
  const property = deal.propertyId && typeof deal.propertyId.toJSON === "function"
    ? deal.propertyId.toJSON()
    : deal.propertyId || {};
  const listing = deal.listingId && typeof deal.listingId.toJSON === "function"
    ? deal.listingId.toJSON()
    : deal.listingId || {};

  return {
    id: deal._id ? String(deal._id) : undefined,
    propertyId: deal.propertyId ? String(deal.propertyId._id || deal.propertyId) : null,
    listingId: deal.listingId ? String(deal.listingId._id || deal.listingId) : null,
    title: deal.title,
    description: deal.description,
    discount: deal.discount,
    pricingSnapshot: deal.pricingSnapshot,
    status: deal.status,
    startsAt: deal.startsAt,
    endsAt: deal.endsAt,
    createdBy: deal.createdBy ? String(deal.createdBy) : null,
    publishedAt: deal.publishedAt,
    removedAt: deal.removedAt,
    removedBy: deal.removedBy ? String(deal.removedBy) : null,
    removalReason: deal.removalReason,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    isActive: isDealActive(deal),
    property,
    listing,
  };
}

async function validateDealTarget(propertyId, listingId, reqUser) {
  if (!mongoose.isValidObjectId(propertyId)) {
    throw new Error("A valid propertyId is required.");
  }
  if (!mongoose.isValidObjectId(listingId)) {
    throw new Error("A valid listingId is required.");
  }

  const property = await Property.findById(propertyId).lean();
  if (!property) {
    throw new Error("Property not found.");
  }

  const listing = await Listing.findOne({ _id: listingId, propertyId }).lean();
  if (!listing) {
    throw new Error("Listing not found for this property.");
  }

  if (property.moderationStatus !== "approved") {
    throw new Error("The property must be approved before creating a deal.");
  }
  if (listing.status !== "published") {
    throw new Error("Deals can only be attached to published listings.");
  }
  if (!reqUser || !reqUser.userId) {
    throw new Error("Authentication is required.");
  }

  return { property, listing };
}

function ensureNoActiveOverlap(listingId, startsAt, endsAt, ignoreDealId = null) {
  return Deal.find({
    listingId,
    status: { $in: ["published", "paused"] },
    _id: ignoreDealId ? { $ne: ignoreDealId } : { $ne: null },
  }).then((deals) => {
    const candidateStart = new Date(startsAt);
    const candidateEnd = endsAt ? new Date(endsAt) : null;

    const overlapping = deals.some((deal) => {
      if (!deal.startsAt) return false;

      const dealStart = new Date(deal.startsAt);
      const dealEnd = deal.endsAt ? new Date(deal.endsAt) : null;

      const candidateHasEnd = candidateEnd && !Number.isNaN(candidateEnd.getTime());
      const dealHasEnd = dealEnd && !Number.isNaN(dealEnd.getTime());

      if (!candidateHasEnd && !dealHasEnd) {
        return true;
      }

      if (candidateHasEnd && dealHasEnd) {
        return candidateStart <= dealEnd && dealStart <= candidateEnd;
      }

      if (candidateHasEnd && !dealHasEnd) {
        return candidateStart <= dealStart || candidateStart <= dealEnd;
      }

      if (!candidateHasEnd && dealHasEnd) {
        return dealStart <= candidateEnd;
      }

      return false;
    });

    if (overlapping) {
      throw new Error(
        "This listing already has a published or active deal in the selected date range.",
      );
    }
  });
}

async function getPublicDeals(_req, res) {
  try {
    const deals = await Deal.find({ status: "published" })
      .populate("propertyId")
      .populate("listingId")
      .sort({ createdAt: -1 });

    const activeDeals = deals.filter((deal) => isDealActive(deal, new Date()));

    return res.status(200).json({
      deals: activeDeals.map((deal) => serializeDeal(deal)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch deals." });
  }
}

async function getDealsForManagement(_req, res) {
  try {
    const deals = await Deal.find({})
      .populate("propertyId")
      .populate("listingId")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      deals: deals.map((deal) => serializeDeal(deal)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Unable to fetch deals for management." });
  }
}

async function createDeal(req, res) {
  try {
    const { propertyId, listingId, title, description, discount, startsAt, endsAt, status } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "A title is required for the deal." });
    }

    const { listing } = await validateDealTarget(propertyId, listingId, req.user);

    if (!discount || !discount.type || !discount.value) {
      return res.status(400).json({ message: "A discount type and value are required." });
    }

    const dealPrice = calculateDiscountPrice(
      Number(listing.price),
      discount.type,
      Number(discount.value),
    );

    const startDate = startsAt ? new Date(startsAt) : new Date();
    const endDate = endsAt ? new Date(endsAt) : null;
    if (endDate && Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ message: "The end date must be valid." });
    }
    if (endDate && endDate < startDate) {
      return res.status(400).json({ message: "The deal end date must be after the start date." });
    }

    await ensureNoActiveOverlap(listingId, startDate, endDate);

    const deal = await Deal.create({
      propertyId,
      listingId,
      title: title.trim(),
      description: description?.trim() || "",
      discount: {
        type: discount.type,
        value: Number(discount.value),
      },
      pricingSnapshot: {
        basePrice: Number(listing.price),
        dealPrice,
        currency: listing.currency,
        billingPeriod: listing.billingPeriod,
      },
      status: ["published", "draft", "paused", "removed"].includes(status) ? status : "draft",
      startsAt: startDate,
      endsAt: endDate,
      createdBy: req.user.userId,
      publishedAt: status === "published" ? new Date() : null,
    });

    const populatedDeal = await Deal.findById(deal._id)
      .populate("propertyId")
      .populate("listingId");

    return res.status(201).json({
      success: true,
      deal: serializeDeal(populatedDeal),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Unable to create deal." });
  }
}

async function updateDeal(req, res) {
  try {
    const deal = await Deal.findById(req.params.dealId);
    if (!deal) {
      return res.status(404).json({ message: "Deal not found." });
    }

    const { title, description, discount, startsAt, endsAt } = req.body || {};

    if (title !== undefined) deal.title = title.trim();
    if (description !== undefined) deal.description = description.trim();
    if (discount) {
      if (!discount.type || discount.value === undefined) {
        return res.status(400).json({ message: "Incomplete discount payload." });
      }
      const listing = await Listing.findById(deal.listingId);
      deal.discount = { type: discount.type, value: Number(discount.value) };
      deal.pricingSnapshot = {
        ...deal.pricingSnapshot,
        basePrice: Number(listing.price),
        dealPrice: calculateDiscountPrice(Number(listing.price), discount.type, Number(discount.value)),
      };
    }
    if (startsAt !== undefined) deal.startsAt = new Date(startsAt);
    if (endsAt !== undefined) deal.endsAt = endsAt ? new Date(endsAt) : null;

    await deal.save();

    const populatedDeal = await Deal.findById(deal._id)
      .populate("propertyId")
      .populate("listingId");

    return res.status(200).json({
      success: true,
      deal: serializeDeal(populatedDeal),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Unable to update deal." });
  }
}

async function updateDealStatus(req, res) {
  try {
    const { status, reason } = req.body || {};
    const allowed = ["draft", "published", "paused", "removed"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Invalid deal status." });
    }

    const deal = await Deal.findById(req.params.dealId);
    if (!deal) {
      return res.status(404).json({ message: "Deal not found." });
    }

    deal.status = status;
    if (status === "published") {
      deal.publishedAt = new Date();
    } else if (status === "removed") {
      deal.removedAt = new Date();
      deal.removedBy = req.user.userId;
      deal.removalReason = reason || "Removed by administrator";
    } else {
      deal.removedAt = null;
      deal.removedBy = null;
      deal.removalReason = undefined;
    }

    await deal.save();

    const populatedDeal = await Deal.findById(deal._id)
      .populate("propertyId")
      .populate("listingId");

    return res.status(200).json({
      success: true,
      deal: serializeDeal(populatedDeal),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Unable to update deal status." });
  }
}

async function removeDeal(req, res) {
  try {
    const deal = await Deal.findById(req.params.dealId);
    if (!deal) {
      return res.status(404).json({ message: "Deal not found." });
    }

    deal.status = "removed";
    deal.removedAt = new Date();
    deal.removedBy = req.user.userId;
    deal.removalReason = req.body?.reason || "Removed by administrator";
    await deal.save();

    return res.status(200).json({
      success: true,
      message: "Deal removed successfully.",
      deal: serializeDeal(deal),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Unable to remove deal." });
  }
}

module.exports = {
  calculateDiscountPrice,
  normalizeDealStatus,
  isDealActive,
  getPublicDeals,
  getDealsForManagement,
  createDeal,
  updateDeal,
  updateDealStatus,
  removeDeal,
};
