const {
  studentsTableName,
  coursesTableName,
  enrollmentsTableName,
  listItems,
} = require("../database/dynamodb");
const { buildEnrollmentCodeMap } = require("../utils/enrollmentCodes");

/** YYYY-MM(-DD), or DD/MM/YYYY, or DD-MM-YYYY → YYYY-MM for bucketing */
function parseEnrollmentMonth(isoDateStr) {
  if (!isoDateStr || typeof isoDateStr !== "string") return null;
  const s = isoDateStr.trim();
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dmy) {
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

/** Last 6 calendar months up to and including the current month (oldest first). */
function buildLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "short" });
    months.push({ key, label });
  }
  return months;
}

exports.summary = async (req, res) => {
  try {
    const [students, courses, enrollments] = await Promise.all([
      listItems(studentsTableName),
      listItems(coursesTableName),
      listItems(enrollmentsTableName),
    ]);

    const codeMap = buildEnrollmentCodeMap(enrollments);
    const recent = [...enrollments]
      .sort((a, b) => String(b.enrollmentDate || "").localeCompare(String(a.enrollmentDate || "")))
      .slice(0, 5)
      .map((e) => ({ ...e, enrollmentCode: codeMap.get(e.id) }));

    const monthSlots = buildLast6Months();
    const countsByMonth = new Map(monthSlots.map((m) => [m.key, 0]));
    for (const e of enrollments) {
      const mk = parseEnrollmentMonth(e.enrollmentDate || "");
      if (mk && countsByMonth.has(mk)) {
        countsByMonth.set(mk, countsByMonth.get(mk) + 1);
      }
    }
    const monthlyEnrollments = monthSlots.map((m) => ({
      monthKey: m.key,
      monthLabel: m.label,
      count: countsByMonth.get(m.key) || 0,
    }));

    const coursesMap = new Map(courses.map((c) => [c.id, c.name]));
    const byCourse = new Map();
    for (const e of enrollments) {
      const cid = (e.courseId || "").trim();
      if (!cid) continue;
      byCourse.set(cid, (byCourse.get(cid) || 0) + 1);
    }
    const courseDistribution = [...byCourse.entries()]
      .map(([courseId, count]) => ({
        courseId,
        courseName: coursesMap.get(courseId) || courseId,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return res.json({
      totalStudents: students.length,
      totalCourses: courses.length,
      totalEnrollments: enrollments.length,
      recentEnrollments: recent,
      monthlyEnrollments,
      courseDistribution,
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve dashboard summary", error: err.message });
  }
};

