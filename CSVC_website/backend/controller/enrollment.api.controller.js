const crypto = require("crypto");
const {
  studentsTableName,
  coursesTableName,
  enrollmentsTableName,
  createItem,
  listItems,
  getItemById,
  updateItemById,
  deleteItemById,
} = require("../database/dynamodb");
const { buildEnrollmentCodeMap } = require("../utils/enrollmentCodes");

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeEnrollment(body) {
  return {
    studentId: (body.studentId || "").trim(),
    courseId: (body.courseId || "").trim(),
    enrollmentDate: (body.enrollmentDate || "").trim(),
    status: (body.status || "Active").trim(),
  };
}

function expandEnrollment(enrollment, studentsMap, coursesMap) {
  return {
    ...enrollment,
    studentName: studentsMap.get(enrollment.studentId) || enrollment.studentId || "",
    courseName: coursesMap.get(enrollment.courseId) || enrollment.courseId || "",
  };
}

exports.create = async (req, res) => {
  try {
    const payload = sanitizeEnrollment(req.body);
    if (!payload.studentId || !payload.courseId || !payload.enrollmentDate || !payload.status) {
      return res.status(400).json({ message: "studentId, courseId, enrollmentDate, and status are required" });
    }
    const data = await createItem(enrollmentsTableName, { id: generateId(), ...payload });
    const all = await listItems(enrollmentsTableName);
    const codeMap = buildEnrollmentCodeMap(all);
    return res.status(201).json({ ...data, enrollmentCode: codeMap.get(data.id) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to create enrollment", error: err.message });
  }
};

exports.findAll = async (req, res) => {
  try {
    const [enrollments, students, courses] = await Promise.all([
      listItems(enrollmentsTableName),
      listItems(studentsTableName),
      listItems(coursesTableName),
    ]);
    const studentsMap = new Map(students.map((s) => [s.id, s.name]));
    const coursesMap = new Map(courses.map((c) => [c.id, c.name]));
    const codeMap = buildEnrollmentCodeMap(enrollments);
    const expanded = enrollments.map((e) => ({
      ...expandEnrollment(e, studentsMap, coursesMap),
      enrollmentCode: codeMap.get(e.id),
    }));
    return res.json(expanded);
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve enrollments", error: err.message });
  }
};

exports.findOne = async (req, res) => {
  try {
    const enrollment = await getItemById(enrollmentsTableName, req.params.id);
    if (!enrollment) return res.status(404).json({ message: "Enrollment not found" });
    const all = await listItems(enrollmentsTableName);
    const codeMap = buildEnrollmentCodeMap(all);
    return res.json({ ...enrollment, enrollmentCode: codeMap.get(enrollment.id) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve enrollment", error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const payload = sanitizeEnrollment(req.body);
    if (!payload.studentId || !payload.courseId || !payload.enrollmentDate || !payload.status) {
      return res.status(400).json({ message: "studentId, courseId, enrollmentDate, and status are required" });
    }
    const data = await updateItemById(enrollmentsTableName, req.params.id, payload, "Enrollment");
    if (!data) return res.status(404).json({ message: "Enrollment not found" });
    const all = await listItems(enrollmentsTableName);
    const codeMap = buildEnrollmentCodeMap(all);
    return res.json({ ...data, enrollmentCode: codeMap.get(data.id) });
  } catch (err) {
    if (err.kind === "not_found") return res.status(404).json({ message: "Enrollment not found" });
    return res.status(500).json({ message: "Failed to update enrollment", error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await deleteItemById(enrollmentsTableName, req.params.id, "Enrollment");
    return res.status(204).send();
  } catch (err) {
    if (err.kind === "not_found") return res.status(404).json({ message: "Enrollment not found" });
    return res.status(500).json({ message: "Failed to delete enrollment", error: err.message });
  }
};

