const Student = require("../models/student.model");
const {
  uploadStudentImage,
  deleteObjectByKey,
  deleteStudentImageByUrl,
  keyFromOurBucketUrl,
  getObjectBuffer,
} = require("../services/s3StudentImage");

function normalizeStudentId(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim().toUpperCase();
  const m = /^TP(\d{6})$/.exec(s);
  return m ? `TP${m[1]}` : null;
}

function toStudentPayload(body) {
  return new Student({
    id: body.id,
    name: body.name,
    address: body.address,
    city: body.city,
    state: body.state,
    email: body.email,
    phone: body.phone,
    imageUrl: body.imageUrl,
  });
}

function bodyWithoutClientImageUrl(body) {
  const o = { ...(body || {}) };
  delete o.imageUrl;
  delete o.photoUrl;
  return o;
}

/** DynamoDB / clients may use mixed casing; expose stable imageUrl/photoUrl for the API. */
function studentForApi(item) {
  if (!item) return item;
  const imageUrl = item.imageUrl || item.ImageUrl;
  const photoUrl = item.photoUrl || item.PhotoUrl;
  return { ...item, imageUrl, photoUrl };
}

function studentCreate(student) {
  return new Promise((resolve, reject) => {
    Student.create(student, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function studentFindById(id) {
  return new Promise((resolve, reject) => {
    Student.findById(id, (err, data) => {
      if (err && err.kind === "not_found") resolve(null);
      else if (err) reject(err);
      else resolve(data);
    });
  });
}

function studentUpdateById(id, student) {
  return new Promise((resolve, reject) => {
    Student.updateById(id, student, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function studentDelete(id) {
  return new Promise((resolve, reject) => {
    Student.delete(id, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function studentGetAll() {
  return new Promise((resolve, reject) => {
    Student.getAll((err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function studentRemoveAll() {
  return new Promise((resolve, reject) => {
    Student.removeAll((err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

exports.create = async (req, res) => {
  const id = normalizeStudentId(req.body.id);
  if (!id) {
    return res.status(400).json({
      message: "Student ID must be TP followed by exactly 6 digits (e.g. TP078736)",
    });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ message: "A profile picture is required when adding a student" });
  }

  let uploadedKey = null;
  try {
    const { imageUrl, key } = await uploadStudentImage(
      req.file.buffer,
      id,
      req.file.originalname,
      req.file.mimetype
    );
    uploadedKey = key;

    const student = toStudentPayload({ ...bodyWithoutClientImageUrl(req.body), id, imageUrl });
    const data = await studentCreate(student);
    return res.status(201).json(studentForApi(data));
  } catch (err) {
    if (uploadedKey) await deleteObjectByKey(uploadedKey);
    if (err.kind === "duplicate") {
      return res.status(409).json({ message: err.message });
    }
    if (err.kind === "validation") {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: "Failed to create student", error: err.message });
  }
};

exports.findAll = (req, res) => {
  Student.getAll((err, data) => {
    if (err) {
      return res.status(500).json({ message: "Failed to retrieve students", error: err.message });
    }
    const rows = Array.isArray(data) ? data.map(studentForApi) : data;
    return res.json(rows);
  });
};

exports.findOne = (req, res) => {
  Student.findById(req.params.id, (err, data) => {
    if (err) {
      if (err.kind === "not_found") {
        return res.status(404).json({ message: `Student with id ${req.params.id} not found` });
      }
      return res.status(500).json({ message: "Failed to retrieve student", error: err.message });
    }
    return res.json(studentForApi(data));
  });
};

exports.update = async (req, res) => {
  try {
    const existing = await studentFindById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: `Student with id ${req.params.id} not found` });
    }

    let imageUrl = existing.imageUrl || existing.photoUrl;
    if (req.file && req.file.buffer) {
      const { imageUrl: nextUrl, key: newKey } = await uploadStudentImage(
        req.file.buffer,
        req.params.id,
        req.file.originalname,
        req.file.mimetype
      );
      const oldS3 =
        keyFromOurBucketUrl(existing.imageUrl) || keyFromOurBucketUrl(existing.photoUrl);
      if (oldS3 && oldS3 !== newKey) {
        await deleteObjectByKey(oldS3);
      }
      imageUrl = nextUrl;
    }

    const student = toStudentPayload({ ...bodyWithoutClientImageUrl(req.body), imageUrl });
    const data = await studentUpdateById(req.params.id, student);
    return res.json(studentForApi(data));
  } catch (err) {
    if (err.kind === "not_found") {
      return res.status(404).json({ message: `Student with id ${req.params.id} not found` });
    }
    return res.status(500).json({ message: "Failed to update student", error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await studentFindById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: `Student with id ${req.params.id} not found` });
    }

    await studentDelete(req.params.id);
    await deleteStudentImageByUrl(existing.imageUrl);
    await deleteStudentImageByUrl(existing.photoUrl);
    return res.status(204).send();
  } catch (err) {
    if (err.kind === "not_found") {
      return res.status(404).json({ message: `Student with id ${req.params.id} not found` });
    }
    return res.status(500).json({ message: "Failed to delete student", error: err.message });
  }
};

exports.removeAll = async (req, res) => {
  try {
    const students = await studentGetAll();
    const data = await studentRemoveAll();
    for (const s of students || []) {
      if (s && s.imageUrl) await deleteStudentImageByUrl(s.imageUrl);
      if (s && s.photoUrl) await deleteStudentImageByUrl(s.photoUrl);
    }
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete all students", error: err.message });
  }
};

/**
 * Stream student image from S3 (works when bucket objects are private; browser uses API URL as img src).
 */
exports.getPhoto = async (req, res) => {
  try {
    const id = req.params.id;
    const student = await studentFindById(id);
    if (!student) return res.status(404).end();
    const url = student.imageUrl || student.photoUrl || student.ImageUrl || student.PhotoUrl;
    if (!url) return res.status(404).end();

    const key = keyFromOurBucketUrl(url);
    if (key) {
      const result = await getObjectBuffer(key);
      if (!result || !result.body) return res.status(404).end();
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.send(result.body);
    }

    if (url.startsWith("http://") || url.startsWith("https://")) {
      return res.redirect(302, url);
    }
    return res.status(404).end();
  } catch (err) {
    console.error("getPhoto", err.message);
    return res.status(500).end();
  }
};
