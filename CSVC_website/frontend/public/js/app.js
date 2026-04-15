const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://localhost";
const API = {
  dashboard: `${API_BASE_URL}/api/dashboard/summary`,
  students: `${API_BASE_URL}/api/students`,
  courses: `${API_BASE_URL}/api/courses`,
  enrollments: `${API_BASE_URL}/api/enrollments`,
};

const appState = {
  students: [],
  courses: [],
  enrollments: [],
  activePage: "home",
  modalType: null,
  /** Last dashboard API payload (for totals); charts use enrollments/courses from appState. */
  dashboardSummary: null,
};

let dashboardLineChart = null;
let dashboardPieChart = null;

/** Revoked when modal closes or when a new file preview replaces it */
let studentPhotoPreviewObjectUrl = null;

function revokeStudentPhotoPreviewUrl() {
  if (studentPhotoPreviewObjectUrl) {
    URL.revokeObjectURL(studentPhotoPreviewObjectUrl);
    studentPhotoPreviewObjectUrl = null;
  }
}

let recentActivityPage = 1;
const RECENT_ACTIVITY_PAGE_SIZE = 5;
let recentActivityFilterSyncKey = "";

function statusBadgeClass(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "active") return "status-badge status-badge--active";
  if (s === "pending") return "status-badge status-badge--pending";
  if (s === "completed") return "status-badge status-badge--completed";
  if (s === "dropped") return "status-badge status-badge--dropped";
  return "status-badge status-badge--neutral";
}

function csvEscapeCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function syncRecentActivityFilterOptions() {
  const statusSel = document.getElementById("recent-activity-status");
  const courseSel = document.getElementById("recent-activity-course");
  if (!statusSel || !courseSel) return;

  const key = `${appState.enrollments.length}-${appState.courses.map((c) => c.id).join(",")}`;
  if (key === recentActivityFilterSyncKey) return;
  recentActivityFilterSyncKey = key;

  const prevStatus = statusSel.value;
  const prevCourse = courseSel.value;

  const statuses = new Set(["Active", "Completed", "Dropped"]);
  appState.enrollments.forEach((e) => {
    if (e.status) statuses.add(e.status);
  });
  const sortedStatuses = [...statuses].sort((a, b) => a.localeCompare(b));

  statusSel.innerHTML =
    '<option value="">All Status</option>' +
    sortedStatuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");

  const courseOpts = appState.courses.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  courseSel.innerHTML =
    '<option value="">All Courses</option>' +
    courseOpts
      .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
      .join("");

  if (prevStatus && sortedStatuses.includes(prevStatus)) statusSel.value = prevStatus;
  if (prevCourse && appState.courses.some((c) => c.id === prevCourse)) courseSel.value = prevCourse;
}

function getRecentActivityFilteredRows() {
  const searchEl = document.getElementById("recent-activity-search");
  const statusEl = document.getElementById("recent-activity-status");
  const courseEl = document.getElementById("recent-activity-course");
  const q = (searchEl && searchEl.value.trim().toLowerCase()) || "";
  const statusFilter = (statusEl && statusEl.value) || "";
  const courseFilter = (courseEl && courseEl.value) || "";

  const sorted = [...appState.enrollments].sort((a, b) =>
    String(b.enrollmentDate || "").localeCompare(String(a.enrollmentDate || ""))
  );

  return sorted.filter((e) => {
    if (statusFilter && String(e.status || "") !== statusFilter) return false;
    if (courseFilter && String(e.courseId || "") !== courseFilter) return false;
    if (!q) return true;
    const fields = [
      e.enrollmentCode,
      e.id,
      e.studentId,
      e.studentName,
      e.courseId,
      e.courseName,
      e.enrollmentDate,
      e.status,
    ];
    return fields.some((f) => String(f || "").toLowerCase().includes(q));
  });
}

function renderRecentActivityPagination(totalItems, pageSize, currentPage, totalPages) {
  const nav = document.getElementById("recent-activity-pagination");
  const rangeEl = document.getElementById("recent-activity-range");
  if (!nav || !rangeEl) return;

  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  rangeEl.textContent = `Showing ${start} to ${end} of ${totalItems} results`;

  if (totalPages <= 1) {
    nav.innerHTML = `
      <button type="button" class="page-btn page-btn--nav" data-recent-nav="prev" disabled aria-label="Previous page">‹ Previous</button>
      <button type="button" class="page-btn page-btn--nav" data-recent-nav="next" disabled aria-label="Next page">Next ›</button>
    `;
    return;
  }

  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  const pageButtons = [];
  for (let p = 1; p <= totalPages; p += 1) {
    const active = p === currentPage ? " page-btn--active" : "";
    const ariaCur = p === currentPage ? ' aria-current="page"' : "";
    pageButtons.push(
      `<button type="button" class="page-btn${active}" data-recent-page="${p}" aria-label="Page ${p}"${ariaCur}>${p}</button>`
    );
  }

  nav.innerHTML = `
    <button type="button" class="page-btn page-btn--nav" data-recent-nav="prev" ${prevDisabled ? "disabled" : ""} aria-label="Previous page">‹ Previous</button>
    ${pageButtons.join("")}
    <button type="button" class="page-btn page-btn--nav" data-recent-nav="next" ${nextDisabled ? "disabled" : ""} aria-label="Next page">Next ›</button>
  `;
}

function renderRecentActivity() {
  const tbody = document.getElementById("recent-activity-body");
  if (!tbody) return;

  syncRecentActivityFilterOptions();

  const filtered = getRecentActivityFilteredRows();
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / RECENT_ACTIVITY_PAGE_SIZE) || 1);
  if (recentActivityPage > totalPages) recentActivityPage = totalPages;
  if (recentActivityPage < 1) recentActivityPage = 1;

  const pageItems = filtered.slice(
    (recentActivityPage - 1) * RECENT_ACTIVITY_PAGE_SIZE,
    recentActivityPage * RECENT_ACTIVITY_PAGE_SIZE
  );

  const rows = pageItems
    .map((raw) => enrichEnrollmentForDisplay(raw))
    .map(
      (e) => `<tr>
      <td class="enrollment-id-cell">${escapeHtml(e.enrollmentCode || e.id)}</td>
      <td>${escapeHtml(e.studentId)}</td>
      <td>${escapeHtml(e.studentName)}</td>
      <td>${escapeHtml(e.courseName)}</td>
      <td>${escapeHtml(e.enrollmentDate)}</td>
      <td><span class="${statusBadgeClass(e.status)}">${escapeHtml(e.status)}</span></td>
    </tr>`
    )
    .join("");

  tbody.innerHTML =
    rows ||
    '<tr><td colspan="6" class="table-empty">No enrollments match your filters.</td></tr>';

  renderRecentActivityPagination(totalItems, RECENT_ACTIVITY_PAGE_SIZE, recentActivityPage, totalPages);
}

function exportRecentActivityCsv() {
  const filtered = getRecentActivityFilteredRows().map((e) => enrichEnrollmentForDisplay(e));
  const headers = ["Enrollment ID", "Student ID", "Student Name", "Course", "Enrollment Date", "Status"];
  const lines = [
    headers.map(csvEscapeCell).join(","),
    ...filtered.map((e) =>
      [e.enrollmentCode || e.id, e.studentId, e.studentName, e.courseName, e.enrollmentDate, e.status].map(csvEscapeCell).join(",")
    ),
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `enrollments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const pageTitle = document.getElementById("page-title");
const globalStatus = document.getElementById("global-status");
const navItems = Array.from(document.querySelectorAll(".nav-item"));
const pages = Array.from(document.querySelectorAll(".page"));
const modal = document.getElementById("entity-modal");
const modalTitle = document.getElementById("modal-title");
const entityForm = document.getElementById("entity-form");
const entityId = document.getElementById("entity-id");
const entityFields = document.getElementById("entity-fields");
const closeModalBtn = document.getElementById("close-modal-btn");
const cancelModalBtn = document.getElementById("cancel-modal-btn");

function showStatus(message, type = "info") {
  globalStatus.className = `alert alert-${type}`;
  globalStatus.textContent = message;
}

function clearStatus() {
  globalStatus.className = "alert d-none";
  globalStatus.textContent = "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Prefix for course id: initials from multiple words, or alphanumeric slug from a single word (matches backend CSVC-01 style). */
function deriveCourseIdPrefix(name) {
  const t = name.trim();
  if (!t) return "";
  const words = t.split(/\s+/).filter(Boolean);
  let prefix;
  if (words.length >= 2) {
    prefix = words
      .map((w) => {
        const m = w.match(/[A-Za-z0-9]/);
        return m ? m[0] : "";
      })
      .join("")
      .toUpperCase();
    if (prefix.length < 2) {
      prefix = words.join("").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 10);
    }
  } else {
    prefix = words[0].replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
  }
  prefix = String(prefix).toUpperCase();
  if (!prefix) prefix = "COURSE";
  if (!/^[A-Za-z0-9]/.test(prefix)) prefix = `C${prefix}`;
  return prefix;
}

/** Next two-digit suffix for PREFIX-01, PREFIX-02, … among existing course ids. */
function nextCourseIdTwoDigitSuffix(prefix, existingIds) {
  const re = new RegExp(`^${escapeRegExp(prefix)}-(\\d{2})$`);
  let max = 0;
  for (const cid of existingIds) {
    const m = re.exec(cid);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const next = max + 1;
  if (next > 99) return null;
  return String(next).padStart(2, "0");
}

/** Any stored image field (API normalizes casing; tolerate legacy keys). */
function studentImageUrlKey(student) {
  if (!student) return "";
  return (
    student.imageUrl ||
    student.photoUrl ||
    student.ImageUrl ||
    student.PhotoUrl ||
    ""
  );
}

/**
 * URL for showing a student's image in <img> and lightbox.
 * Always uses the API proxy for this student id so the server can resolve S3/private URLs.
 * Cache-bust query avoids stale 404/photo after replace (same path, new object).
 */
function studentPhotoDisplayUrl(student) {
  if (!student || !student.id) return "";
  const base = `${API_BASE_URL}/api/students/${encodeURIComponent(student.id)}/photo`;
  const v = studentImageUrlKey(student);
  if (!v) return base;
  return `${base}?v=${encodeURIComponent(String(v).slice(-80))}`;
}

/** Legacy: raw stored URL (e.g. for debugging). Prefer studentPhotoDisplayUrl for UI. */
function studentPhotoSrc(imageUrlOrLegacy) {
  if (!imageUrlOrLegacy) return "";
  const u = String(imageUrlOrLegacy);
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = API_BASE_URL.replace(/\/$/, "");
  const path = u.startsWith("/") ? u : `/${u}`;
  return base + path;
}

const photoLightbox = document.getElementById("photo-lightbox");
const photoLightboxImg = document.getElementById("photo-lightbox-img");
const photoLightboxBackdrop = document.getElementById("photo-lightbox-backdrop");
const photoLightboxClose = document.getElementById("photo-lightbox-close");

function openPhotoLightbox(imageUrl) {
  if (!imageUrl || !photoLightbox || !photoLightboxImg) return;
  photoLightboxImg.src = imageUrl;
  photoLightboxImg.alt = "Student photo";
  photoLightbox.classList.remove("d-none");
  document.body.style.overflow = "hidden";
}

function closePhotoLightbox() {
  if (!photoLightbox || !photoLightboxImg) return;
  photoLightbox.classList.add("d-none");
  photoLightboxImg.removeAttribute("src");
  document.body.style.overflow = "";
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err && err.message) message = err.message;
      if (err && err.error) message = `${message}: ${err.error}`;
    } catch (parseError) {
      // no-op
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

const PAGE_TITLES = {
  home: "Home",
  students: "Student Management",
  courses: "Course Management",
  enrollments: "Enrollment Management",
};

function switchPage(pageName) {
  appState.activePage = pageName;
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.page === pageName));
  pages.forEach((page) => page.classList.toggle("active", page.id === `page-${pageName}`));
  pageTitle.textContent =
    PAGE_TITLES[pageName] ?? pageName.charAt(0).toUpperCase() + pageName.slice(1);
  window.location.hash = pageName;
  if (pageName === "home" && appState.dashboardSummary) {
    requestAnimationFrame(() => renderDashboardCharts(appState.dashboardSummary));
  }
}

function openModal(type, mode, data = {}) {
  appState.modalType = { type, mode };
  entityId.value = data.id || "";

  if (type === "student") {
    modalTitle.textContent = mode === "edit" ? "Edit Student" : "Add Student";
    const idField =
      mode === "create"
        ? `<div class="form-group">
        <label>Student ID</label>
        <input class="form-control" name="id" required autocomplete="off" placeholder="e.g., TP078736"
          pattern="[Tt][Pp][0-9]{6}" title="TP followed by exactly 6 digits" value="">
      </div>`
        : `<div class="form-group">
        <label>Student ID</label>
        <input class="form-control" value="${escapeHtml(data.id)}" readonly disabled>
        <small class="form-text text-muted">Student ID cannot be changed after creation.</small>
      </div>`;
    const photoField =
      mode === "create"
        ? `<div class="student-photo-card">
        <div class="student-photo-header">
          <span class="student-photo-title">Student image</span>
          <span class="student-photo-badge">Required</span>
        </div>
        <div class="student-photo-preview-row">
          <img class="student-thumb-lg student-thumb-lg--create" data-student-photo-preview hidden alt="Selected photo preview">
        </div>
        <div class="student-photo-dropzone">
          <input class="student-photo-input-native" type="file" name="photo" id="student-photo-file"
            accept="image/jpeg,image/png,image/gif,image/webp" required>
          <div class="student-photo-dropzone-inner">
            <span class="student-photo-icon" aria-hidden="true">📷</span>
            <p class="student-photo-lead"><strong>Upload a photo</strong></p>
            <p class="student-photo-filename">No file selected</p>
            <p class="student-photo-sub">Click or tap this area to choose a file</p>
          </div>
        </div>
        <p class="student-photo-hint">This image will be saved on S3</p>
      </div>`
        : `<div class="student-photo-card">
        <div class="student-photo-header">
          <span class="student-photo-title">Student image</span>
        </div>
        ${(() => {
          const fullSrc = studentPhotoDisplayUrl(data);
          return `<div class="student-photo-current"><button type="button" class="student-photo-view-btn" data-photo-full="${escapeHtml(fullSrc)}" title="View full photo"><img class="student-thumb-lg" data-student-photo-preview src="${escapeHtml(fullSrc)}" alt="Student photo"></button><p class="student-photo-view-hint">Click photo to enlarge</p></div>`;
        })()}
        <div class="student-photo-dropzone student-photo-dropzone-optional">
          <input class="student-photo-input-native" type="file" name="photo" id="student-photo-file"
            accept="image/jpeg,image/png,image/gif,image/webp">
          <div class="student-photo-dropzone-inner">
            <span class="student-photo-icon" aria-hidden="true">📷</span>
            <p class="student-photo-lead"><strong>Replace photo</strong> <span class="student-photo-optional">(optional)</span></p>
            <p class="student-photo-filename">No new file selected</p>
            <p class="student-photo-sub">Leave unchanged to keep the current image</p>
          </div>
        </div>
        <p class="student-photo-hint">Optional new image · Same formats as above</p>
      </div>`;
    entityFields.innerHTML = `
      ${idField}
      <div class="form-group">
        <label>Name</label>
        <input class="form-control" name="name" required value="${escapeHtml(data.name)}">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input class="form-control" name="email" type="email" required value="${escapeHtml(data.email)}">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input class="form-control" name="phone" value="${escapeHtml(data.phone)}">
      </div>
      <div class="form-group">
        <label>Address</label>
        <input class="form-control" name="address" value="${escapeHtml(data.address)}">
      </div>
      <div class="form-row">
        <div class="form-group col-md-6">
          <label>City</label>
          <input class="form-control" name="city" value="${escapeHtml(data.city)}">
        </div>
        <div class="form-group col-md-6">
          <label>State</label>
          <input class="form-control" name="state" value="${escapeHtml(data.state)}">
        </div>
      </div>
      ${photoField}
    `;
    const photoInput = entityFields.querySelector(".student-photo-input-native");
    const fileNameEl = entityFields.querySelector(".student-photo-filename");
    const previewImg = entityFields.querySelector("img[data-student-photo-preview]");
    const viewBtn = entityFields.querySelector(".student-photo-current .student-photo-view-btn");
    if (photoInput && fileNameEl) {
      const defaultNoFile =
        mode === "create" ? "No file selected" : "No new file selected";
      const restoreEditPreviewFromServer = () => {
        if (mode !== "edit" || !previewImg) return;
        revokeStudentPhotoPreviewUrl();
        const u = studentPhotoDisplayUrl(data);
        previewImg.src = u;
        if (viewBtn) viewBtn.setAttribute("data-photo-full", u);
      };
      photoInput.addEventListener("change", () => {
        const f = photoInput.files && photoInput.files[0];
        fileNameEl.textContent = f ? f.name : defaultNoFile;
        if (mode === "edit" && previewImg && viewBtn) {
          if (f) {
            revokeStudentPhotoPreviewUrl();
            studentPhotoPreviewObjectUrl = URL.createObjectURL(f);
            previewImg.src = studentPhotoPreviewObjectUrl;
            viewBtn.setAttribute("data-photo-full", studentPhotoPreviewObjectUrl);
          } else {
            restoreEditPreviewFromServer();
          }
        }
        if (mode === "create" && previewImg) {
          revokeStudentPhotoPreviewUrl();
          if (f) {
            studentPhotoPreviewObjectUrl = URL.createObjectURL(f);
            previewImg.src = studentPhotoPreviewObjectUrl;
            previewImg.removeAttribute("hidden");
          } else {
            previewImg.removeAttribute("src");
            previewImg.setAttribute("hidden", "");
          }
        }
      });
    }
    if (mode === "create" && previewImg) {
      previewImg.setAttribute("hidden", "");
    }
  } else if (type === "course") {
    modalTitle.textContent = mode === "edit" ? "Edit Course" : "Add Course";
    if (mode === "create") {
      entityFields.innerHTML = `
      <div class="form-group">
        <label>Course Name</label>
        <input class="form-control" name="name" required value="${escapeHtml(data.name)}" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Course ID</label>
        <input class="form-control" name="id" required readonly autocomplete="off"
          pattern="[A-Za-z0-9][A-Za-z0-9_-]*-[0-9]{2}"
          title="Prefix derived from course name, hyphen, then two digits (e.g. CSVC-01)">
        <small class="form-text text-muted">Course ID generated automatically when you enter the course name</small>
      </div>
      <div class="form-group">
        <label>Course fee</label>
        <input class="form-control" name="courseFee" placeholder="e.g. RM 250" value="${escapeHtml(data.courseFee)}">
        <small class="form-text text-muted">Enter amount in Malaysian Ringgit, e.g. RM 250</small>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-control" name="description" rows="4">${escapeHtml(data.description)}</textarea>
      </div>
    `;
      const nameInput = entityFields.querySelector('input[name="name"]');
      const idInput = entityFields.querySelector('input[name="id"]');
      const syncCourseIdFromName = () => {
        const prefix = deriveCourseIdPrefix(nameInput.value);
        if (!prefix) {
          idInput.value = "";
          return;
        }
        const suffix = nextCourseIdTwoDigitSuffix(
          prefix,
          appState.courses.map((c) => c.id)
        );
        if (!suffix) {
          idInput.value = "";
          idInput.setCustomValidity("Too many courses for this name pattern (max 99). Change the course name slightly.");
          return;
        }
        idInput.setCustomValidity("");
        idInput.value = `${prefix}-${suffix}`;
      };
      nameInput.addEventListener("input", syncCourseIdFromName);
      syncCourseIdFromName();
    } else {
      entityFields.innerHTML = `
      <div class="form-group">
        <label>Course ID</label>
        <input class="form-control" value="${escapeHtml(data.id)}" readonly disabled>
        <small class="form-text text-muted">Course ID cannot be changed after creation.</small>
      </div>
      <div class="form-group">
        <label>Course Name</label>
        <input class="form-control" name="name" required value="${escapeHtml(data.name)}">
      </div>
      <div class="form-group">
        <label>Course fee</label>
        <input class="form-control" name="courseFee" placeholder="e.g. RM 250" value="${escapeHtml(data.courseFee)}">
        <small class="form-text text-muted">Enter amount in Malaysian Ringgit, e.g. RM 250</small>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea class="form-control" name="description" rows="4">${escapeHtml(data.description)}</textarea>
      </div>
    `;
    }
  } else if (type === "enrollment") {
    modalTitle.textContent = mode === "edit" ? "Edit Enrollment" : "Enroll Student";
    entityFields.innerHTML = `
      <div class="form-group">
        <label>Student</label>
        <select class="form-control" name="studentId" required>
          <option value="">Select student</option>
          ${appState.students
            .map(
              (s) =>
                `<option value="${escapeHtml(s.id)}" ${s.id === data.studentId ? "selected" : ""}>${escapeHtml(
                  s.name
                )}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Course</label>
        <select class="form-control" name="courseId" required>
          <option value="">Select course</option>
          ${appState.courses
            .map(
              (c) =>
                `<option value="${escapeHtml(c.id)}" ${c.id === data.courseId ? "selected" : ""}>${escapeHtml(
                  c.name
                )}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label>Enrollment Date</label>
        <input class="form-control" type="date" name="enrollmentDate" required value="${escapeHtml(
          data.enrollmentDate
        )}">
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-control" name="status" required>
          ${["Active", "Completed", "Dropped"]
            .map((status) => `<option value="${status}" ${status === data.status ? "selected" : ""}>${status}</option>`)
            .join("")}
        </select>
      </div>
    `;
  }

  if (type === "student") {
    entityForm.setAttribute("enctype", "multipart/form-data");
  } else {
    entityForm.removeAttribute("enctype");
  }

  modal.classList.remove("d-none");
}

function closeModal() {
  revokeStudentPhotoPreviewUrl();
  modal.classList.add("d-none");
  entityForm.reset();
  entityForm.removeAttribute("enctype");
  entityFields.innerHTML = "";
  appState.modalType = null;
}

function renderStudents() {
  const keyword = document.getElementById("student-search").value.trim().toLowerCase();
  const rows = appState.students
    .filter((s) =>
      !keyword ||
      [s.id, s.name, s.email, s.phone].some((f) => String(f || "").toLowerCase().includes(keyword))
    )
    .map((s) => {
      const src = studentPhotoDisplayUrl(s);
      const thumb = s.id
        ? `<button type="button" class="student-photo-view-btn student-thumb-wrap" data-photo-full="${escapeHtml(src)}" title="View photo"><img class="student-thumb" src="${escapeHtml(src)}" alt="" loading="lazy"></button>`
        : '<span class="student-thumb-placeholder">—</span>';
      return `<tr>
      <td>${thumb}</td>
      <td>${escapeHtml(s.id)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.email)}</td>
      <td>${escapeHtml(s.phone)}</td>
      <td>
        <button class="action-btn action-edit" data-action="edit-student" data-id="${escapeHtml(s.id)}">Edit</button>
        <button class="action-btn action-delete" data-action="delete-student" data-id="${escapeHtml(s.id)}">Delete</button>
      </td>
    </tr>`;
    })
    .join("");
  document.getElementById("students-body").innerHTML =
    rows || '<tr><td colspan="6" class="text-center">No students found</td></tr>';
}

function renderCourses() {
  const keyword = document.getElementById("course-search").value.trim().toLowerCase();
  const rows = appState.courses
    .filter(
      (c) =>
        !keyword ||
        [c.id, c.name, c.description, c.courseFee].some((f) => String(f || "").toLowerCase().includes(keyword))
    )
    .map(
      (c) => `<tr>
      <td>${escapeHtml(c.id)}</td>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.courseFee)}</td>
      <td>${escapeHtml(c.description)}</td>
      <td>
        <button class="action-btn action-edit" data-action="edit-course" data-id="${escapeHtml(c.id)}">Edit</button>
        <button class="action-btn action-delete" data-action="delete-course" data-id="${escapeHtml(c.id)}">Delete</button>
      </td>
    </tr>`
    )
    .join("");
  document.getElementById("courses-body").innerHTML =
    rows || '<tr><td colspan="5" class="text-center">No courses found</td></tr>';
}

/** Fill student/course names from appState if API row is missing expanded fields. */
function enrichEnrollmentForDisplay(e) {
  if (!e) return e;
  const student = appState.students.find((s) => s.id === e.studentId);
  const course = appState.courses.find((c) => c.id === e.courseId);
  return {
    ...e,
    studentName: e.studentName || (student && student.name) || e.studentId || "",
    courseName: e.courseName || (course && course.name) || e.courseId || "",
  };
}

function renderEnrollments() {
  const keyword = document.getElementById("enrollment-search").value.trim().toLowerCase();
  const rows = appState.enrollments
    .map((raw) => enrichEnrollmentForDisplay(raw))
    .filter((e) => {
      if (!keyword) return true;
      const idStr = String(e.enrollmentCode || e.id || "");
      return [idStr, e.studentId, e.courseId, e.studentName, e.courseName, e.enrollmentDate, e.status].some((f) =>
        String(f || "").toLowerCase().includes(keyword)
      );
    })
    .map(
      (e) => `<tr>
      <td class="enrollment-id-cell">${escapeHtml(e.enrollmentCode || e.id)}</td>
      <td>${escapeHtml(e.studentName)}</td>
      <td>${escapeHtml(e.courseName)}</td>
      <td>${escapeHtml(e.enrollmentDate)}</td>
      <td>${escapeHtml(e.status)}</td>
      <td>
        <button class="action-btn action-edit" data-action="edit-enrollment" data-id="${escapeHtml(e.id)}">Edit</button>
        <button class="action-btn action-delete" data-action="delete-enrollment" data-id="${escapeHtml(e.id)}">Delete</button>
      </td>
    </tr>`
    )
    .join("");
  document.getElementById("enrollments-body").innerHTML =
    rows || '<tr><td colspan="6" class="text-center">No enrollments found</td></tr>';
}

/** Match dashboard API: YYYY-MM(-DD), DD/MM/YYYY, DD-MM-YYYY, or Date.parse. */
function parseEnrollmentMonthForChart(isoDateStr) {
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

function buildLast6MonthsClient() {
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

function computeMonthlyEnrollmentsFromState(enrollments) {
  const monthSlots = buildLast6MonthsClient();
  const countsByMonth = new Map(monthSlots.map((m) => [m.key, 0]));
  for (const e of enrollments) {
    const mk = parseEnrollmentMonthForChart(e.enrollmentDate || "");
    if (mk && countsByMonth.has(mk)) {
      countsByMonth.set(mk, countsByMonth.get(mk) + 1);
    }
  }
  return monthSlots.map((m) => ({
    monthKey: m.key,
    monthLabel: m.label,
    count: countsByMonth.get(m.key) || 0,
  }));
}

function computeCourseDistributionFromState(enrollments, courses) {
  const coursesMap = new Map(courses.map((c) => [c.id, c.name]));
  const byCourse = new Map();
  for (const e of enrollments) {
    const cid = (e.courseId || "").trim();
    if (!cid) continue;
    byCourse.set(cid, (byCourse.get(cid) || 0) + 1);
  }
  return [...byCourse.entries()]
    .map(([courseId, count]) => ({
      courseId,
      courseName: coursesMap.get(courseId) || courseId,
      count: Number(count) || 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Charts use appState enrollments/courses so they always match the API list and never show empty
 * when the dashboard summary payload is missing or older than the deployed backend.
 */
function resolveDashboardChartSeries() {
  const monthly = computeMonthlyEnrollmentsFromState(appState.enrollments);
  const dist = computeCourseDistributionFromState(appState.enrollments, appState.courses);
  return { monthly, dist };
}

function renderDashboardCharts(summary) {
  const lineCanvas = document.getElementById("chart-monthly-enrollments");
  const pieCanvas = document.getElementById("chart-course-distribution");
  if (typeof Chart === "undefined" || !lineCanvas || !pieCanvas) {
    console.warn("[Dashboard charts] Chart.js or canvas elements missing");
    return;
  }

  if (dashboardLineChart) {
    dashboardLineChart.destroy();
    dashboardLineChart = null;
  }
  if (dashboardPieChart) {
    dashboardPieChart.destroy();
    dashboardPieChart = null;
  }

  const { monthly, dist } = resolveDashboardChartSeries();
  const lineLabels = monthly.map((m) => m.monthLabel);
  const lineData = monthly.map((m) => Number(m.count) || 0);
  const maxVal = lineData.length ? Math.max(...lineData) : 0;
  const ySuggestedMax = Math.max(4, maxVal + 1);

  console.log("[Dashboard charts] series", {
    monthlyEnrollments: monthly,
    courseDistribution: dist,
    enrollmentCount: appState.enrollments.length,
    courseCount: appState.courses.length,
    summaryKeys: summary && typeof summary === "object" ? Object.keys(summary) : [],
  });

  const lineEmptyPlugin = {
    id: "lineEmptyHint",
    afterDraw(chart) {
      if (maxVal > 0) return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.fillStyle = "#9ca3af";
      ctx.font = "13px system-ui, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const text =
        appState.enrollments.length === 0
          ? "No enrollments yet"
          : "No enrollments in the last 6 months";
      ctx.fillText(
        text,
        chartArea.left + chartArea.width / 2,
        chartArea.top + chartArea.height / 2
      );
      ctx.restore();
    },
  };

  dashboardLineChart = new Chart(lineCanvas.getContext("2d"), {
    type: "line",
    data: {
      labels: lineLabels,
      datasets: [
        {
          label: "Enrollments",
          data: lineData,
          borderColor: "#2c5cc5",
          backgroundColor: "rgba(44, 92, 197, 0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointBackgroundColor: "#2c5cc5",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: true, position: "bottom" },
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: ySuggestedMax,
          ticks: { precision: 0 },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        x: {
          grid: { display: false },
        },
      },
    },
    plugins: [lineEmptyPlugin],
  });

  const pieColors = ["#2c5cc5", "#8b5cf6", "#14b8a6", "#f97316", "#22c55e", "#ec4899", "#6366f1", "#0ea5e9"];

  const pieEmptyPlugin = {
    id: "pieEmptyHint",
    afterDraw(chart) {
      if (dist.length > 0) return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.fillStyle = "#6b7280";
      ctx.font = "14px system-ui, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "No enrollment data",
        chartArea.left + chartArea.width / 2,
        chartArea.top + chartArea.height / 2
      );
      ctx.restore();
    },
  };

  if (dist.length === 0) {
    dashboardPieChart = new Chart(pieCanvas.getContext("2d"), {
      type: "pie",
      data: {
        labels: ["No data"],
        datasets: [{ data: [1], backgroundColor: ["#e8edf5"] }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [pieEmptyPlugin],
    });
  } else {
    const pieValues = dist.map((d) => Number(d.count) || 0);
    dashboardPieChart = new Chart(pieCanvas.getContext("2d"), {
      type: "pie",
      data: {
        labels: dist.map((d) => d.courseName || d.courseId),
        datasets: [
          {
            data: pieValues,
            backgroundColor: dist.map((_, i) => pieColors[i % pieColors.length]),
            borderWidth: 1,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: { boxWidth: 12, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);
                const v = Number(ctx.raw) || 0;
                const pct = total ? Math.round((v / total) * 100) : 0;
                return `${ctx.label}: ${v} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }
}

function renderDashboard(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  appState.dashboardSummary = s;

  document.getElementById("summary-students").textContent = s.totalStudents ?? 0;
  document.getElementById("summary-courses").textContent = s.totalCourses ?? 0;
  document.getElementById("summary-enrollments").textContent = s.totalEnrollments ?? 0;

  renderRecentActivity();
  renderDashboardCharts(s);
}

async function reloadAllData() {
  try {
    clearStatus();
    recentActivityFilterSyncKey = "";
    const [students, courses, enrollments, summary] = await Promise.all([
      requestJson(API.students, { method: "GET" }),
      requestJson(API.courses, { method: "GET" }),
      requestJson(API.enrollments, { method: "GET" }),
      requestJson(API.dashboard, { method: "GET" }),
    ]);

    appState.students = Array.isArray(students) ? students : [];
    appState.courses = Array.isArray(courses) ? courses : [];
    appState.enrollments = Array.isArray(enrollments) ? enrollments : [];

    renderStudents();
    renderCourses();
    renderEnrollments();
    renderDashboard(summary || {});
  } catch (err) {
    showStatus(err.message, "danger");
  }
}

entityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(entityForm);
  const payload = Object.fromEntries(formData.entries());
  const id = entityId.value;
  if (!appState.modalType) return;

  try {
    const { type, mode } = appState.modalType;
    if (type === "student") {
      if (!payload.name || !payload.email) throw new Error("Name and email are required");
      if (mode === "create") {
        if (!payload.id || !String(payload.id).trim()) throw new Error("Student ID is required");
        const photo = formData.get("photo");
        if (!photo || !photo.size) throw new Error("Profile picture is required");
      }
      const url = mode === "edit" ? `${API.students}/${encodeURIComponent(id)}` : API.students;
      const method = mode === "edit" ? "PUT" : "POST";
      const res = await fetch(url, { method, body: formData });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const err = await res.json();
          if (err && err.message) message = err.message;
        } catch (parseError) {
          // no-op
        }
        throw new Error(message);
      }
      if (res.status !== 204) await res.json();
    } else if (type === "course") {
      if (!payload.name) throw new Error("Course name is required");
      if (mode === "create") {
        if (!payload.id || !String(payload.id).trim()) throw new Error("Course ID is required");
      }
      const url =
        mode === "edit" ? `${API.courses}/${encodeURIComponent(id)}` : API.courses;
      const method = mode === "edit" ? "PUT" : "POST";
      const courseBody =
        mode === "edit"
          ? { name: payload.name, courseFee: payload.courseFee, description: payload.description }
          : {
              id: payload.id,
              name: payload.name,
              courseFee: payload.courseFee,
              description: payload.description,
            };
      await requestJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(courseBody),
      });
    } else if (type === "enrollment") {
      if (!payload.studentId || !payload.courseId || !payload.enrollmentDate || !payload.status) {
        throw new Error("All enrollment fields are required");
      }
      const url = mode === "edit" ? `${API.enrollments}/${id}` : API.enrollments;
      const method = mode === "edit" ? "PUT" : "POST";
      await requestJson(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    closeModal();
    showStatus("Saved successfully", "success");
    await reloadAllData();
  } catch (err) {
    showStatus(err.message, "danger");
  }
});

document.body.addEventListener("click", async (event) => {
  const action = event.target.dataset.action;
  const id = event.target.dataset.id;
  if (!action || !id) return;

  try {
    if (action === "edit-student") {
      const item = appState.students.find((s) => s.id === id);
      openModal("student", "edit", item || {});
    } else if (action === "delete-student") {
      if (!window.confirm("Delete this student?")) return;
      await requestJson(`${API.students}/${id}`, { method: "DELETE" });
      showStatus("Student deleted", "success");
      await reloadAllData();
    } else if (action === "edit-course") {
      const item = appState.courses.find((c) => c.id === id);
      openModal("course", "edit", item || {});
    } else if (action === "delete-course") {
      if (!window.confirm("Delete this course?")) return;
      await requestJson(`${API.courses}/${encodeURIComponent(id)}`, { method: "DELETE" });
      showStatus("Course deleted", "success");
      await reloadAllData();
    } else if (action === "edit-enrollment") {
      const item = appState.enrollments.find((e) => e.id === id);
      openModal("enrollment", "edit", item || {});
    } else if (action === "delete-enrollment") {
      if (!window.confirm("Delete this enrollment?")) return;
      await requestJson(`${API.enrollments}/${id}`, { method: "DELETE" });
      showStatus("Enrollment deleted", "success");
      await reloadAllData();
    }
  } catch (err) {
    showStatus(err.message, "danger");
  }
});

document.getElementById("add-student-btn").addEventListener("click", () => openModal("student", "create"));
document.getElementById("add-course-btn").addEventListener("click", () => openModal("course", "create"));
document.getElementById("add-enrollment-btn").addEventListener("click", () => openModal("enrollment", "create"));
document.getElementById("student-search").addEventListener("input", renderStudents);
document.getElementById("course-search").addEventListener("input", renderCourses);
document.getElementById("enrollment-search").addEventListener("input", renderEnrollments);
document.getElementById("refresh-home-btn").addEventListener("click", reloadAllData);

const recentActivitySearch = document.getElementById("recent-activity-search");
const recentActivityStatus = document.getElementById("recent-activity-status");
const recentActivityCourse = document.getElementById("recent-activity-course");
const recentActivityExport = document.getElementById("recent-activity-export");
const recentActivityFilterFocus = document.getElementById("recent-activity-filter-focus");

if (recentActivitySearch) {
  recentActivitySearch.addEventListener("input", () => {
    recentActivityPage = 1;
    renderRecentActivity();
  });
}
if (recentActivityStatus) {
  recentActivityStatus.addEventListener("change", () => {
    recentActivityPage = 1;
    renderRecentActivity();
  });
}
if (recentActivityCourse) {
  recentActivityCourse.addEventListener("change", () => {
    recentActivityPage = 1;
    renderRecentActivity();
  });
}
if (recentActivityExport) {
  recentActivityExport.addEventListener("click", () => exportRecentActivityCsv());
}
if (recentActivityFilterFocus && recentActivitySearch) {
  recentActivityFilterFocus.addEventListener("click", () => {
    recentActivitySearch.focus();
  });
}

document.body.addEventListener("click", (event) => {
  const pageBtn = event.target.closest("[data-recent-page]");
  if (pageBtn) {
    const p = parseInt(pageBtn.getAttribute("data-recent-page"), 10);
    if (!Number.isNaN(p)) {
      recentActivityPage = p;
      renderRecentActivity();
    }
    return;
  }
  const navBtn = event.target.closest("[data-recent-nav]");
  if (!navBtn || !navBtn.closest("#recent-activity-pagination")) return;
  const filtered = getRecentActivityFilteredRows();
  const totalPages = Math.max(1, Math.ceil(filtered.length / RECENT_ACTIVITY_PAGE_SIZE));
  const dir = navBtn.getAttribute("data-recent-nav");
  if (dir === "prev") recentActivityPage = Math.max(1, recentActivityPage - 1);
  if (dir === "next") recentActivityPage = Math.min(totalPages, recentActivityPage + 1);
  renderRecentActivity();
});
closeModalBtn.addEventListener("click", closeModal);
cancelModalBtn.addEventListener("click", closeModal);

document.body.addEventListener("click", (event) => {
  const viewBtn = event.target.closest(".student-photo-view-btn");
  const url = viewBtn && viewBtn.getAttribute("data-photo-full");
  if (!viewBtn || !url) return;
  event.preventDefault();
  event.stopPropagation();
  openPhotoLightbox(url);
});

document.body.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (!img || !img.matches || !img.matches("img.student-thumb, img.student-thumb-lg")) return;
    if (img.dataset.studentPhotoErrorHandled) return;
    img.dataset.studentPhotoErrorHandled = "1";
    const btn = img.closest(".student-photo-view-btn");
    if (img.matches("img.student-thumb")) {
      const ph = document.createElement("span");
      ph.className = "student-thumb-placeholder";
      ph.textContent = "—";
      ph.title = "Photo not available";
      if (btn) btn.replaceWith(ph);
      else img.replaceWith(ph);
      return;
    }
    const span = document.createElement("span");
    span.className = "student-thumb-lg student-thumb-lg--missing";
    span.textContent = "No photo";
    span.title = "Photo not available";
    if (btn) btn.replaceWith(span);
    else img.replaceWith(span);
  },
  true
);

if (photoLightboxBackdrop) {
  photoLightboxBackdrop.addEventListener("click", closePhotoLightbox);
}
if (photoLightboxClose) {
  photoLightboxClose.addEventListener("click", closePhotoLightbox);
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !photoLightbox || photoLightbox.classList.contains("d-none")) return;
  closePhotoLightbox();
});

navItems.forEach((item) => {
  item.addEventListener("click", () => switchPage(item.dataset.page));
});

const initialPage = window.location.hash.replace("#", "") || "home";
switchPage(["home", "students", "courses", "enrollments"].includes(initialPage) ? initialPage : "home");
reloadAllData();

