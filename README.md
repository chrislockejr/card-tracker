# Card Tracker

A local web app for tracking a trading card collection — wrestling and soccer. Built with Python/Flask and SQLite, runs entirely on your own machine with no internet connection required (except for eBay/130point search links).

## Features

- **Two card types** — Wrestling (Wrestler, Brand, Card Type, Card #, Cost, Value, Notes) and Soccer (Player, Team, League, Card Type, Card #, Year, Cost, Value, Notes)
- **Value tracking over time** — every time you update a card's value, a snapshot is saved. Click the chart icon on any card to see its value history as a line graph
- **Portfolio view** — aggregate cost, value, and P&L across your whole collection, with a chart of total value over time
- **Market search buttons** — each card has one-click eBay and 130point search links pre-filled with the card's details
- **Sort & filter** — click any column header to sort; filter by name, brand/team, and card type
- **Pagination** — handles thousands of cards comfortably (25/50/100/200 per page)
- **CSV export** — download your full collection as a CSV at any time for backups or spreadsheet use
- **CSV import** — bulk-import cards from a CSV file (matching the export format)

## Requirements

- macOS, Linux, or Windows
- Python 3.7 or newer
- pip (comes with Python)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/chrislockejr/card-tracker.git
cd card-tracker
```

### 2. Install Python dependencies

```bash
pip3 install flask flask-sqlalchemy
```

> **Windows users:** use `pip` instead of `pip3` if `pip3` is not found.

### 3. Start the app

```bash
python3 app.py
```

On first run this creates the database file automatically (`instance/cards.db`).

> **Windows users:** use `python` instead of `python3`.

### 4. Open the app

Open your browser and go to:

```
http://localhost:5000
```

That's it. The app runs entirely on your machine — no account, no cloud, no fees.

## Starting the app after the first install

Each time you want to use the app, open a terminal in the `card-tracker` folder and run:

```bash
python3 app.py
```

Then visit `http://localhost:5000`. Press `Ctrl+C` in the terminal to stop it.

**macOS shortcut** — there is also a `start.sh` script you can double-click from Finder (you may need to right-click → Open the first time to allow it):

```bash
./start.sh
```

## Autostart on login (macOS)

To have the app start automatically whenever you log in, set it up as a launchd service:

**1. Create the plist file:**

```bash
cat > ~/Library/LaunchAgents/com.cardtracker.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cardtracker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/chris/card-tracker/app.py</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PYTHONPATH</key>
        <string>/usr/local/lib/python3.7/site-packages</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>/Users/chris/card-tracker</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/chris/card-tracker/logs/output.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/chris/card-tracker/logs/error.log</string>
</dict>
</plist>
EOF
```

**2. Create the logs directory and load the service:**

```bash
mkdir -p ~/card-tracker/logs
launchctl load ~/Library/LaunchAgents/com.cardtracker.plist
```

The app will now start automatically at login and restart itself if it crashes. Logs are written to `card-tracker/logs/`.

**Managing the service:**

```bash
launchctl unload ~/Library/LaunchAgents/com.cardtracker.plist  # disable autostart
launchctl stop com.cardtracker                                  # stop now
launchctl start com.cardtracker                                 # start now
```

## Backing up your data

Your card data lives in `instance/cards.db` (a SQLite database file). To back it up, just copy that file somewhere safe — you do not need to stop the server first.

For a guaranteed consistent snapshot (useful for automated backups), use SQLite's built-in backup command:

```bash
sqlite3 instance/cards.db ".backup instance/cards_backup.db"
```

You can also export a CSV from inside the app using the **Export CSV** button on either the Wrestling or Soccer tab, but note that CSV export only covers active cards — it does not include value history, sales records, or box purchases. Use the database file for full backups.

> The database file is excluded from git (via `.gitignore`) so your personal card data is never uploaded to GitHub.

## Importing from a spreadsheet

If you currently track cards in a spreadsheet, you can import them:

1. Open the **Export CSV** button first to download an empty template showing the expected column headers
2. Copy your spreadsheet data into a CSV matching those headers
3. Use the **Import CSV** button on the relevant tab to load the file

**Wrestling CSV columns:** `Wrestler Name, Brand, Card Type, Card Number, Cost, Value, Notes`

**Soccer CSV columns:** `Player Name, Team, League, Card Type, Card Number, Year, Cost, Value, Notes`

The `ID` and `Created At` columns in the export are informational and can be omitted when importing.

> Importing the same file twice will create duplicate cards — the importer does not deduplicate.

## Project structure

```
card-tracker/
├── app.py                  # Flask app — all routes and database models
├── start.sh                # macOS/Linux convenience launcher
├── instance/
│   └── cards.db            # SQLite database (created on first run, not in git)
├── templates/
│   └── index.html          # Single-page HTML shell
└── static/
    ├── css/style.css        # Custom styles (Bootstrap handles the rest)
    └── js/app.js            # All frontend logic — rendering, API calls, charts
```

## Tech stack

| Layer     | Library/Tool                                      |
|-----------|---------------------------------------------------|
| Backend   | [Flask](https://flask.palletsprojects.com/) + [SQLAlchemy](https://www.sqlalchemy.org/) |
| Database  | SQLite (file-based, no server needed)             |
| Frontend  | Vanilla JS + [Bootstrap 5](https://getbootstrap.com/) |
| Charts    | [Chart.js](https://www.chartjs.org/)              |

All frontend libraries are loaded from a CDN — no npm or build step required.
