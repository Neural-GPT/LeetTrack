"""
Run this ONCE on your own machine, not on the deployed server — it opens
a browser for you to log into the Gmail account LeetTrack should send
OTP emails from, then prints the values to put in your .env.

This is setup tooling only, not part of the running app. The deployed
backend (app/services/email.py) never does an interactive login itself —
it just uses the refresh token this script gets you to silently get a
new access token whenever it needs to send an email.

Setup:
  1. Google Cloud Console -> APIs & Services -> Credentials
     -> Create OAuth client ID -> Application type: Desktop app
     -> download the JSON, save it next to this script as credentials.json
  2. Enable the Gmail API for that project if you haven't already
     (APIs & Services -> Library -> search "Gmail API" -> Enable)
  3. pip install --break-system-packages google-auth google-auth-oauthlib google-api-python-client
  4. python3 scripts/gmail_oauth_setup.py
     -> a browser opens, log in with the Gmail account you want LeetTrack
        to send as, approve the "send email" permission
  5. Copy the printed values into leettrack_backend/.env

credentials.json and token.json are gitignored — never commit either.
"""

import json
import os

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_PATH = os.path.join(SCRIPT_DIR, "credentials.json")
TOKEN_PATH = os.path.join(SCRIPT_DIR, "token.json")

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def main():
    if not os.path.exists(CREDENTIALS_PATH):
        print(f"Missing {CREDENTIALS_PATH}")
        print("Download it from Google Cloud Console (see the docstring above) first.")
        return

    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PATH, "w") as token_file:
            token_file.write(creds.to_json())

    with open(CREDENTIALS_PATH) as f:
        client_config = json.load(f)
    client_info = client_config.get("installed") or client_config.get("web") or {}

    print("\n" + "=" * 60)
    print("Success — put these in leettrack_backend/.env:")
    print("=" * 60)
    print(f"GMAIL_CLIENT_ID={client_info.get('client_id', '')}")
    print(f"GMAIL_CLIENT_SECRET={client_info.get('client_secret', '')}")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print("GMAIL_SENDER_EMAIL=<the Gmail address you just logged in with>")
    print("=" * 60)
    print(
        "\nSet the same four values in your deployment platform's env vars "
        "too (Railway/Render/etc.) — .env only applies locally."
    )


if __name__ == "__main__":
    main()
