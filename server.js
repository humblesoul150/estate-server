const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const { connectDb } = require("./configs/connectDb");
const logger = require("./configs/logger");
dotenv.config();

const PORT = process.env.PORT || 4444;
const HOST = process.env.HOST || "0.0.0.0";
app.use(cors());
app.use(express.json());

// Connect to DB, then start server
if (process.env.SKIP_DB === "true") {
  logger.warn("Skipping database connection for testing");

  app.listen(PORT, HOST, () => {
    logger.info(
      `Server running at http://${HOST}:${PORT} in ${process.env.NODE_ENV || "development"} mode (DB SKIPPED)`,
    );
  });
} else {
  connectDb(process.env.DB_URL)
    .then(() => {
      app.listen(PORT, HOST, () => {
        logger.info(
          `Server running at http://${HOST}:${PORT} in ${process.env.NODE_ENV || "development"} mode`,
        );
      });
    })
    .catch((err) => {
      logger.error("Failed to start server due to DB connection error", err);
      process.exit(1);
    });
}

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is healthy" });
});

//Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const propertyRoutes = require("./routes/propertyRoutes");
const dealRoutes = require("./routes/dealRoutes");

//use routes
app.use("/api", reviewRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/deals", dealRoutes);
