# RT Scanner — Reputation Tenability Android app

Scan credit-card statements and related documents with the phone camera and file them straight into the client's **billing-error (FCBA) exhibit file** in the Reputation Tenability portal. Each upload becomes the next labeled exhibit (Exhibit A, B, C…) and appears immediately on the website's Billing error page.

## What it does
1. **Sign in** with the same username or email and password as the website. The token is stored with Android's hardware-backed encrypted storage.
2. **Scan** with Google's ML Kit document scanner: automatic edge detection, perspective correction, cleanup, multi-page, gallery import. No camera permission is needed.
3. **Build the PDF on the phone** with `PdfEngine` (PdfBox-Android). Pages fit Letter size, aspect ratio kept, JPEG 85%.
4. **Label it:** exhibit category, billing cycle, and whether it's the first statement on the account.
5. **Upload** to `POST /api/mobile/fcba/exhibits`. A receipt shows "Filed as Exhibit C…". If Claude is configured on the portal, the statement is read and screened automatically.
6. **My exhibits** lists everything filed, with analysis status and screening score.

## Build
- Android Studio (Ladybug or newer): **Open** this folder → Run.
- Command line: `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
- CI: every change builds an APK, downloadable from the GitHub Actions run (**rt-scanner-debug-apk**).

The portal address defaults to the live Railway site. Override it with `./gradlew assembleDebug -PportalUrl=https://your-domain`.

## Requirements
- Android 7.0+ (API 24) with Google Play services (for the ML Kit scanner).
- A portal account with a password. Google-only accounts can add a username and password under **Account** on the website.

## Portal API used
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/mobile/login` | `{identifier, password}` → `{token, user}` |
| GET | `/api/mobile/categories` | Exhibit categories |
| POST | `/api/mobile/fcba/exhibits` | Multipart `file`, `category`, `cycle`, `isFirstStatement` |
| GET | `/api/mobile/fcba/exhibits` | The client's exhibits |

All calls except login send `Authorization: Bearer <token>`.

## Releasing to Google Play
Create an upload keystore (never commit it), add a `signingConfigs` block reading it from environment variables, build with `./gradlew bundleRelease`, and upload the `.aab` in Play Console. Play requires a privacy policy URL and a Data safety form. The app uploads financial documents, so declare them as collected, encrypted in transit, and deletable on request.
