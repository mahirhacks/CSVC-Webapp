const {
  coursesTableName,
  createItem,
  listItems,
  getItemById,
  updateItemById,
  deleteItemById,
} = require("../database/dynamodb");

/** CourseName-XX e.g. CSVC-01, VAPT-12 (name part: letters/digits/underscore/hyphen, then hyphen, then exactly two digits) */
function normalizeCourseId(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*-\d{2}$/.test(s)) return null;
  return s;
}

function sanitizeCourse(body) {
  return {
    name: (body.name || "").trim(),
    description: (body.description || "").trim(),
    // Malaysian Ringgit display, e.g. "RM 250" or "250" — stored as entered (trimmed)
    courseFee: (body.courseFee || "").trim(),
  };
}

exports.create = async (req, res) => {
  try {
    const id = normalizeCourseId(req.body.id);
    if (!id) {
      return res.status(400).json({
        message:
          "Course ID is required and must look like CourseName-01: a name prefix, a hyphen, then exactly two digits (e.g. CSVC-01, VAPT-12).",
      });
    }
    const payload = sanitizeCourse(req.body);
    if (!payload.name) return res.status(400).json({ message: "Course name is required" });
    const data = await createItem(coursesTableName, { id, ...payload });
    return res.status(201).json(data);
  } catch (err) {
    if (err.code === "ConditionalCheckFailedException") {
      return res.status(409).json({ message: "A course with this ID already exists" });
    }
    return res.status(500).json({ message: "Failed to create course", error: err.message });
  }
};

exports.findAll = async (req, res) => {
  try {
    const courses = await listItems(coursesTableName);
    return res.json(courses);
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve courses", error: err.message });
  }
};

exports.findOne = async (req, res) => {
  try {
    const course = await getItemById(coursesTableName, req.params.id);
    if (!course) return res.status(404).json({ message: "Course not found" });
    return res.json(course);
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve course", error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const payload = sanitizeCourse(req.body);
    if (!payload.name) return res.status(400).json({ message: "Course name is required" });
    const data = await updateItemById(coursesTableName, req.params.id, payload, "Course");
    if (!data) return res.status(404).json({ message: "Course not found" });
    return res.json(data);
  } catch (err) {
    if (err.kind === "not_found") return res.status(404).json({ message: "Course not found" });
    return res.status(500).json({ message: "Failed to update course", error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await deleteItemById(coursesTableName, req.params.id, "Course");
    return res.status(204).send();
  } catch (err) {
    if (err.kind === "not_found") return res.status(404).json({ message: "Course not found" });
    return res.status(500).json({ message: "Failed to delete course", error: err.message });
  }
};

