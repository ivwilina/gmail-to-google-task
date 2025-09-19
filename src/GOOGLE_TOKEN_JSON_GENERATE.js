const express = require("express");
const { google } = require("googleapis");
require("dotenv").config();

const app = express();
const port = 3069;

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const { client_id, client_secret, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

app.get("/", (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.labels",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/tasks.readonly",
      "https://www.googleapis.com/auth/generative-language.peruserquota",
    ],
  });
  res.redirect(url);
});

app.get("/takeaway", (req, res) => {
  const code = req.query.code;
  oAuth2Client.getToken(code, async (err, token) => {
    if (err) {
      console.error("Couldn't get token", err);
      res.send("Error");
      return;
    }
    oAuth2Client.setCredentials(token);
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const task = google.tasks({ version: "v1", auth: oAuth2Client });

    const tags = ["PRIORITY", "HIGH", "MEDIUM", "LOW"];

    let tokenString = JSON.stringify(token);
    console.log("Copy to .env file:");
    console.log(`GOOGLE_TOKEN_JSON = ${tokenString}`);
    tags.forEach(async (tagName) => {
      const label = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: tagName,
          type: "user",
        },
      });
      const tasklist = await task.tasklists.insert({
        requestBody: {
          title: tagName,
        },
      });
      console.log(`${tagName}_LABEL_ID = ${label.data.id}`);
      console.log(`${tagName}_TASKLIST_ID = ${tasklist.data.id}`);
    });
    res.send("Authenticated successfully!");
  });
});

app.listen(port, () => {
  console.log(`Click this link to authorize: http://localhost:${port}`);
});
