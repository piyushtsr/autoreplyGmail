const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listLabels(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  const res = await gmail.users.labels.list({
    userId: 'me',
  });
  const labels = res.data.labels;
  if (!labels || labels.length === 0) {
    console.log('No labels found.');
    return;
  }
  console.log('Labels:');
  labels.forEach((label) => {
    console.log(`- ${label.name}`);
  });
}

// Set up a function to check for new emails
async function checkForNewEmails() {
    try {
      const response = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        q: 'is:unread'
      });
      if (!response.data.messages) {
        return;
      }
      const messages = response.data.messages;
      for (const message of messages) {
        const email = await getEmail(message.id);
        if (email) {
          const shouldReply = await shouldAutoReply(email);
          if (shouldReply) {
            const response = await sendAutoReply(email);
            await tagEmail(response.data.id, 'AutoReplied');
          }
        }
      }
    } catch (error) {
      console.log(error);
    }
  }
  
  // Set up a function to get email data
  async function getEmail(emailId) {
    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: emailId
      });
      return response.data;
    } catch (error) {
      console.log(error);
    }
  }
  
  // Set up a function to check if an email should receive an auto-reply
  async function shouldAutoReply(email) {
    try {
      // Check if the email has a label indicating it has already been replied to
      if (email.labelIds.includes('AutoReplied')) {
        return false;
      }
      // Check if the email is a reply to a previous email
      if (email.payload.headers.find(header => header.name === 'In-Reply-To')) {
        return false;
      }
      return true;
    } catch (error) {
      console.log(error);
    }
  }
  
  // Set up a function to send an auto-reply
  async function sendAutoReply(email) {
    try {
      // Construct the auto-reply message
      const message = {
        to: email.payload.headers.find(header => header.name === 'From').value,
        subject: 'Auto-Reply: Out of Office',
        body: 'Thank you for your email. I am currently out of the office and will respond to your message as soon as possible.',
        threadId: email.threadId
      };
      // Send the auto-reply message
      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          threadId: message.threadId,
          message: {
            to: message.to,
            subject: message.subject,
            body: {
              plain: message.body
            }
          }
        }
      });
      return response;
    } catch (error) {
      console.log(error);
    }
  }
  
  // Set up a function to tag an email with a label
  async function tagEmail(emailId, labelName) {
    try {
      // Get the label with the given name or create it if it doesn't exist
      const labelResponse = await gmail.users.labels.list({
        userId: 'me'
      });
      let label = labelResponse.data.labels.find(label => label.name === labelName);
      if (!label) {
        label = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: labelName,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show'
          }
        });
      }
      // Tag the email with the label
      await gmail.users.messages.modify({
        userId: 'me',
        id: emailId,
        requestBody: {
          addLabelIds: [label.id]
        }
      });
    } catch (error) {
      console.log(error);
    }
  }
  
 
  

authorize().then(listLabels).catch(console.error);