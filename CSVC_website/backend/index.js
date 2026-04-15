const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config();

const studentApi = require("./controller/student.api.controller");
const { upload } = require("./middleware/studentUpload");
const courseApi = require("./controller/course.api.controller");
const enrollmentApi = require("./controller/enrollment.api.controller");
const dashboardApi = require("./controller/dashboard.api.controller");

// DynamoDB config (loaded for side effects / initialization)
require("./database/dynamodb");
const app = express();

// parse requests of content-type: application/json
app.use(bodyParser.json());
// parse requests of content-type: application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

const allowedOrigin = process.env.FRONTEND_ORIGIN;
app.use(
  cors(
    allowedOrigin
      ? {
          origin: allowedOrigin,
        }
      : undefined
  )
);
app.options("*", cors());

app.get("/", (req, res) => {
  res.json({
    service: "csvc-backend",
    status: "ok",
    endpoints: [
      "GET /api/dashboard/summary",
      "GET /api/students",
      "GET /api/students/:id/photo",
      "GET /api/students/:id",
      "POST /api/students",
      "PUT /api/students/:id",
      "DELETE /api/students/:id",
      "GET /api/courses",
      "GET /api/courses/:id",
      "POST /api/courses",
      "PUT /api/courses/:id",
      "DELETE /api/courses/:id",
      "GET /api/enrollments",
      "GET /api/enrollments/:id",
      "POST /api/enrollments",
      "PUT /api/enrollments/:id",
      "DELETE /api/enrollments/:id",
    ],
  });
});

app.get("/api/dashboard/summary", dashboardApi.summary);
app.get("/api/students", studentApi.findAll);
app.get("/api/students/:id/photo", studentApi.getPhoto);
app.get("/api/students/:id", studentApi.findOne);
app.post("/api/students", upload.single("photo"), studentApi.create);
app.put("/api/students/:id", upload.single("photo"), studentApi.update);
app.delete("/api/students/:id", studentApi.remove);
app.delete("/api/students", studentApi.removeAll);
app.get("/api/courses", courseApi.findAll);
app.get("/api/courses/:id", courseApi.findOne);
app.post("/api/courses", courseApi.create);
app.put("/api/courses/:id", courseApi.update);
app.delete("/api/courses/:id", courseApi.remove);
app.get("/api/enrollments", enrollmentApi.findAll);
app.get("/api/enrollments/:id", enrollmentApi.findOne);
app.post("/api/enrollments", enrollmentApi.create);
app.put("/api/enrollments/:id", enrollmentApi.update);
app.delete("/api/enrollments/:id", enrollmentApi.remove);

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "File too large (max 5 MB)" : err.message;
    return res.status(400).json({ message });
  }
  if (err && err.message && err.message.includes("Only JPEG")) {
    return res.status(400).json({ message: err.message });
  }
  console.error(err);
  return res.status(500).json({ message: err.message || "Internal server error" });
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// set port, listen for requests
const app_port = process.env.APP_PORT || 3000;
app.listen(app_port, () => {
  console.log(`Server is running on port ${app_port}.`);
});