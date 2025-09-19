const { google } = require("googleapis");
require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({});

/**
 * Generate a list of things to do from the email's content
 * @param {*} mailBody: email's content
 * @returns a list of things to do from the email's content
 */
async function generateTaskDetails(mailBody) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
    Phân tích nội dung mail dưới đây và cho tôi biết các công việc chính một cách ngắn gọn theo từng dòng, không cần trình bày đẹp: 
    ${mailBody}`,
    config: {
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });
  return response.text;
}

/**
 * Generate due time of the task in the email
 * @param {*} mailBody: email's content
 * @param {*} receiveDate: email reception date
 * @returns due time of the task in the email, return null if the is no due date
 */
async function generateTaskDue(mailBody, receiveDate) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
    Phân tích nội dung mail dưới đây và cho tôi biết thời hạn của công việc được đề cập trong mail. Chỉ trả lại thời hạn và trả lời dưới định dạng RFC-3339, không giải thích thêm. Nếu không có thời hạn cụ thể, trả lại kết quả null: 
    ${mailBody}
    Ngày nhận mail:
    ${receiveDate}`,
    config: {
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });
  return response.text;
}

/**
 * decode the email's body part
 * @param {*} part: body of the email
 * @returns decoded email's body part
 */
function getBodyPart(part) {
  if (part.mimeType === "text/plain" || part.mimeType === "text/html") {
    if (part.body && part.body.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf8");
    }
  }
  if (part.parts) {
    for (const subPart of part.parts) {
      const body = getBodyPart(subPart);
      if (body) return body;
    }
  }
  return null;
}

/**
 * Check if a task has been created for the email
 * @param {*} auth: OAuth2 Client for Google APIs
 * @param {*} flag: flag that need to check
 * @param {*} emailId: id of the email that need to check
 * @returns email already have task or not
 */
async function isTaskCreatedForEmail(auth, flag, emailId) {
  const tasksApi = google.tasks({ version: "v1", auth: auth });

  let tasklistIdentifier;
  switch (flag) {
    case "priority":
      tasklistIdentifier = process.env.PRIORITY_TASKLIST_ID;
      break;
    case "high":
      tasklistIdentifier = process.env.HIGH_TASKLIST_ID;
      break;
    case "medium":
      tasklistIdentifier = process.env.MEDIUM_TASKLIST_ID;
      break;
    case "low":
      tasklistIdentifier = process.env.LOW_TASKLIST_ID;
      break;
    case "starred":
      tasklistIdentifier = "@default";
      break;
  }

  const res = await tasksApi.tasks.list({
    tasklist: tasklistIdentifier,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
  });

  if (!res.data.items) return false;

  return res.data.items.some(
    (task) => task.title && task.title.includes(`[${emailId}]`)
  );
}

/**
 * Create oAuth2Client
 * 
 */
async function authenticate() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const { client_id, client_secret, redirect_uris } = credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN_JSON));
  return oAuth2Client;
}

/**
 * Get the email that has the flag
 * @param {*} auth: oAuth2Client
 * @param {*} flag
 */
async function getFlaggedEmails(auth, flag) {
  const gmail = google.gmail({ version: "v1", auth: auth });

  let labelIdentifier;
  switch (flag) {
    case "priority":
      labelIdentifier = process.env.PRIORITY_LABEL_ID;
      break;

    case "high":
      labelIdentifier = process.env.HIGH_LABEL_ID;
      break;

    case "medium":
      labelIdentifier = process.env.MEDIUM_LABEL_ID;
      break;

    case "low":
      labelIdentifier = process.env.LOW_LABEL_ID;
      break;

    case "starred":
      labelIdentifier = "STARRED";
      break;
  }

  const res = await gmail.users.messages.list({
    userId: "me",
    labelIds: labelIdentifier,
  });

  if (!res.data.messages) return [];

  const messages = [];
  for (const msg of res.data.messages) {
    const msgData = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const gmailBody = getBodyPart(msgData.data.payload);
    const gmailDetails = await generateTaskDetails(gmailBody);
    const gmailReceiveDate =
      msgData.data.payload.headers.find((header) => header.name === "Date")
        ?.value || "";
    const gmailDue = await generateTaskDue(gmailBody, gmailReceiveDate);

    messages.push({
      id: msg.id,
      subject:
        msgData.data.payload.headers.find((h) => h.name === "Subject")?.value ||
        "No Subject",
      from:
        msgData.data.payload.headers.find((h) => h.name === "From")?.value ||
        "",
      details: gmailDetails,
      due: gmailDue,
    });
  }
  return messages;
}

/**
 * Create a task for the flagged email
 * @param {*} auth: oAuth2Client
 * @param {*} flag
 */
async function createFlaggedTask(auth, email, flag) {
  const tasks = google.tasks({ version: "v1", auth: auth });

  let tasklistIdentifier;
  switch (flag) {
    case "priority":
      tasklistIdentifier = process.env.PRIORITY_TASKLIST_ID;
      break;

    case "high":
      tasklistIdentifier = process.env.HIGH_TASKLIST_ID;
      break;

    case "medium":
      tasklistIdentifier = process.env.MEDIUM_TASKLIST_ID;
      break;

    case "low":
      tasklistIdentifier = process.env.LOW_TASKLIST_ID;
      break;

    case "starred":
      tasklistIdentifier = "@default";
      break;
  }

  await tasks.tasks.insert({
    tasklist: tasklistIdentifier,
    requestBody: {
      title: `[${email.id}] ${email.subject}`,
      notes: `From: ${email.from}\nDetails:\n${email.details}`,
      due: email.due === "null" ? "" : email.due,
    },
  });
  console.log(`Created task for email: ${email.subject}`);
}


async function main() {
  try {
    const auth = await authenticate();
    const flags = ["priority", "high", "medium", "low", "starred"];

    for (const flag of flags) {
      const flaggedEmails = await getFlaggedEmails(auth, flag);

      if (flaggedEmails.length === 0) {
        console.log(`No flagged emails found for flag: ${flag}.`);
        continue;
      }

      for (const email of flaggedEmails) {
        const existed = await isTaskCreatedForEmail(auth, flag, email.id);
        if (!existed) {
          await createFlaggedTask(auth, email, flag);
        }
      }
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();

