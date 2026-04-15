/**
 * Human-readable enrollment codes (ENR01, ENR02, …) derived from all enrollments.
 * Sort: enrollment date ascending, then id — stable for a given dataset.
 * Internal `id` (e.g. DynamoDB key) is unchanged; use `enrollmentCode` for display/export.
 */

function formatEnrollmentCode(index1Based) {
  const n = index1Based;
  const body = n < 100 ? String(n).padStart(2, "0") : String(n);
  return `ENR${body}`;
}

function buildEnrollmentCodeMap(enrollments) {
  const sorted = [...enrollments].sort((a, b) => {
    const da = String(a.enrollmentDate || "");
    const db = String(b.enrollmentDate || "");
    if (da !== db) return da.localeCompare(db);
    return String(a.id).localeCompare(String(b.id));
  });
  const map = new Map();
  sorted.forEach((e, i) => {
    map.set(e.id, formatEnrollmentCode(i + 1));
  });
  return map;
}

module.exports = {
  formatEnrollmentCode,
  buildEnrollmentCodeMap,
};
