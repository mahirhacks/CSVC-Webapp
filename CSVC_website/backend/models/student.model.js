const {
  createStudentItem,
  listStudents,
  getStudentById,
  updateStudentById,
  deleteStudentById,
  deleteAllStudents,
} = require("../database/dynamodb");

const Student = function (student) {
  this.id = student ? student.id : undefined;
  this.name = student ? student.name : undefined;
  this.address = student ? student.address : undefined;
  this.city = student ? student.city : undefined;
  this.state = student ? student.state : undefined;
  this.email = student ? student.email : undefined;
  this.phone = student ? student.phone : undefined;
  this.imageUrl = student ? student.imageUrl : undefined;
  this.photoUrl = student ? student.photoUrl : undefined;
};

Student.create = (newStudent, result) => {
  const id = newStudent && newStudent.id != null ? String(newStudent.id).trim() : "";
  if (!id) {
    return result({ kind: "validation", message: "Student ID is required" }, null);
  }
  const item = { ...newStudent, id };

  createStudentItem(item)
    .then(() => result(null, item))
    .catch((err) => {
      if (err.code === "ConditionalCheckFailedException") {
        return result({ kind: "duplicate", message: "A student with this ID already exists" }, null);
      }
      return result(err, null);
    });
};

Student.getAll = (result) => {
  listStudents()
    .then((items) => result(null, items))
    .catch((err) => result(err, null));
};

Student.findById = (studentId, result) => {
  getStudentById(studentId)
    .then((item) => {
      if (!item) return result({ kind: "not_found" }, null);
      return result(null, item);
    })
    .catch((err) => result(err, null));
};

Student.updateById = (id, student, result) => {
  updateStudentById(id, student)
    .then((updated) => result(null, updated))
    .catch((err) => result(err, null));
};

Student.delete = (id, result) => {
  deleteStudentById(id)
    .then((res) => result(null, res))
    .catch((err) => result(err, null));
};

Student.removeAll = (result) => {
  deleteAllStudents()
    .then((res) => result(null, res))
    .catch((err) => result(err, null));
};

module.exports = Student;
