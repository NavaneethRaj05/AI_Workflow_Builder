/* eslint-disable */
const https = require('https');

const secret = process.argv[2];

if (!secret) {
  console.error("❌ Error: Please provide your Nhost Admin Secret.");
  console.error("Example: node fix-metadata.js my-secret-here");
  process.exit(1);
}

const url = 'https://bykigbyxcjykjxbhakqc.hasura.ap-south-1.nhost.run/v1/metadata';
const payload = JSON.stringify({
  type: "bulk",
  args: [
    {
      type: "pg_track_table",
      args: {
        source: "default",
        table: { schema: "auth", name: "users" },
        configuration: {
          custom_name: "users",
          custom_column_names: {
            display_name: "displayName",
            avatar_url: "avatarUrl"
          }
        }
      }
    },
    {
      type: "pg_create_select_permission",
      args: {
        source: "default",
        table: { schema: "auth", name: "users" },
        role: "user",
        permission: {
          columns: ["id", "email", "display_name", "avatar_url"],
          filter: {}
        }
      }
    }
  ]
});

const req = https.request(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': secret,
    'Content-Length': payload.length
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log("✅ Success! Metadata fixed.");
      console.log("Response:", data);
    } else {
      console.error(`❌ Error (${res.statusCode}):`);
      console.error(data);
    }
  });
});

req.on('error', error => {
  console.error("❌ Request Failed:", error.message);
});

req.write(payload);
req.end();
