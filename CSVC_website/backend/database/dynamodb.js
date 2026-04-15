const AWS = require("aws-sdk");

const region = process.env.AWS_REGION || "us-east-1";
const studentsTableName =
  process.env.STUDENTS_TABLE_NAME ||
  process.env.DYNAMODB_TABLE_NAME ||
  process.env.TABLE_NAME ||
  "Students";
const coursesTableName = process.env.COURSES_TABLE_NAME || "Courses";
const enrollmentsTableName = process.env.ENROLLMENTS_TABLE_NAME || "Enrollments";

const docClient = new AWS.DynamoDB.DocumentClient({ region });

function normalizeId(id) {
  return id === undefined || id === null ? "" : String(id);
}

function normalizeNotFound(err, entityName, id) {
  if (err && err.code === "ConditionalCheckFailedException") {
    const nf = new Error(`${entityName} with id '${id}' not found`);
    nf.kind = "not_found";
    return nf;
  }
  return err;
}

async function createItem(tableName, item) {
  const id = normalizeId(item && item.id);
  if (!id) throw new Error("'id' is required");

  await docClient
    .put({
      TableName: tableName,
      Item: { ...item, id },
      ConditionExpression: "attribute_not_exists(#id)",
      ExpressionAttributeNames: { "#id": "id" },
    })
    .promise();

  return { ...item, id };
}

async function listItems(tableName) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await docClient
      .scan({
        TableName: tableName,
        ExclusiveStartKey,
      })
      .promise();
    if (res && Array.isArray(res.Items)) items.push(...res.Items);
    ExclusiveStartKey = res ? res.LastEvaluatedKey : undefined;
  } while (ExclusiveStartKey);
  return items;
}

async function getItemById(tableName, id) {
  const res = await docClient
    .get({
      TableName: tableName,
      Key: { id: normalizeId(id) },
    })
    .promise();
  return res && res.Item ? res.Item : null;
}

async function updateItemById(tableName, id, updates, entityName = "Item") {
  const itemId = normalizeId(id);
  if (!itemId) throw new Error("'id' is required");

  const updateKeys = Object.keys(updates || {}).filter(
    (key) => updates[key] !== undefined && key !== "id"
  );

  if (updateKeys.length === 0) {
    return getItemById(tableName, itemId);
  }

  const ExpressionAttributeNames = { "#id": "id" };
  const ExpressionAttributeValues = {};
  const setExpressions = [];

  for (const key of updateKeys) {
    const nameToken = `#${key}`;
    const valueToken = `:${key}`;
    ExpressionAttributeNames[nameToken] = key;
    ExpressionAttributeValues[valueToken] = updates[key];
    setExpressions.push(`${nameToken} = ${valueToken}`);
  }

  try {
    await docClient
      .update({
        TableName: tableName,
        Key: { id: itemId },
        UpdateExpression: `SET ${setExpressions.join(", ")}`,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ConditionExpression: "attribute_exists(#id)",
      })
      .promise();
  } catch (err) {
    throw normalizeNotFound(err, entityName, itemId);
  }

  return getItemById(tableName, itemId);
}

async function deleteItemById(tableName, id, entityName = "Item") {
  const itemId = normalizeId(id);
  if (!itemId) throw new Error("'id' is required");

  try {
    await docClient
      .delete({
        TableName: tableName,
        Key: { id: itemId },
        ConditionExpression: "attribute_exists(#id)",
        ExpressionAttributeNames: { "#id": "id" },
      })
      .promise();
  } catch (err) {
    throw normalizeNotFound(err, entityName, itemId);
  }

  return { id: itemId };
}

async function deleteAllItems(tableName, entityName = "Item") {
  const items = await listItems(tableName);
  for (const item of items) {
    await deleteItemById(tableName, item.id, entityName);
  }
  return { deleted: items.length };
}

async function createStudentItem(item) {
  return createItem(studentsTableName, item);
}
async function listStudents() {
  return listItems(studentsTableName);
}
async function getStudentById(id) {
  return getItemById(studentsTableName, id);
}
async function updateStudentById(id, updates) {
  return updateItemById(studentsTableName, id, updates, "Student");
}
async function deleteStudentById(id) {
  return deleteItemById(studentsTableName, id, "Student");
}
async function deleteAllStudents() {
  return deleteAllItems(studentsTableName, "Student");
}

module.exports = {
  docClient,
  region,
  studentsTableName,
  coursesTableName,
  enrollmentsTableName,
  createItem,
  listItems,
  getItemById,
  updateItemById,
  deleteItemById,
  deleteAllItems,
  createStudentItem,
  listStudents,
  getStudentById,
  updateStudentById,
  deleteStudentById,
  deleteAllStudents,
};

