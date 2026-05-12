"""
Card Tracker — Flask backend
Handles all data storage and API endpoints for the trading card inventory app.
Data is stored in a local SQLite database (instance/cards.db).
"""

import csv
import io
from datetime import date, datetime
from flask import Flask, render_template, request, jsonify, send_file, abort
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///cards.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class WrestlingCard(db.Model):
    __tablename__ = "wrestling_cards"
    id            = db.Column(db.Integer, primary_key=True)
    wrestler_name = db.Column(db.String(200), nullable=False)
    set_name      = db.Column(db.String(200))   # e.g. Topps Chrome WWE 2026
    brand         = db.Column(db.String(100))   # Raw, SmackDown, AEW, etc.
    card_type     = db.Column(db.String(100))   # Base, Refractor, Auto, etc.
    card_number   = db.Column(db.String(50))    # e.g. "12/25" for numbered cards
    cost          = db.Column(db.Float, default=0.0)
    current_value = db.Column(db.Float, default=0.0)
    source        = db.Column(db.String(50), default="Single")  # Single, Blaster Box, Hobby Box, etc.
    box_id        = db.Column(db.Integer, db.ForeignKey("boxes.id"), nullable=True)
    notes         = db.Column(db.Text)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship to value history. Uses a string-based join condition because
    # ValueHistory stores card_type as a discriminator column rather than using
    # separate FK columns for each card table.
    history = db.relationship(
        "ValueHistory", backref="wrestling_card", lazy="dynamic",
        primaryjoin="and_(ValueHistory.card_type=='wrestling', foreign(ValueHistory.card_id)==WrestlingCard.id)",
        foreign_keys="[ValueHistory.card_id]"
    )


class SoccerCard(db.Model):
    __tablename__ = "soccer_cards"
    id            = db.Column(db.Integer, primary_key=True)
    player_name   = db.Column(db.String(200), nullable=False)
    set_name      = db.Column(db.String(200))   # e.g. Donruss Road to World Cup 25-26
    team          = db.Column(db.String(100))
    league        = db.Column(db.String(100))   # Premier League, La Liga, etc.
    card_type     = db.Column(db.String(100))
    card_number   = db.Column(db.String(50))
    year          = db.Column(db.Integer)
    cost          = db.Column(db.Float, default=0.0)
    current_value = db.Column(db.Float, default=0.0)
    source        = db.Column(db.String(50), default="Single")
    box_id        = db.Column(db.Integer, db.ForeignKey("boxes.id"), nullable=True)
    notes         = db.Column(db.Text)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Box(db.Model):
    """A box purchase (Blaster, Hobby, Retail Pack, etc.) that cards can be linked to.
    Cost tracking for box-pulled cards works by dividing the box cost across
    all cards linked to it; the app suggests this value when adding a card."""
    __tablename__ = "boxes"
    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(200), nullable=False)  # e.g. "Topps Chrome WWE 2026 Blaster"
    box_type   = db.Column(db.String(50))                   # Blaster Box, Hobby Box, Retail Pack
    cost       = db.Column(db.Float, default=0.0)
    notes      = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ValueHistory(db.Model):
    """
    Stores one value snapshot per card per day. When a card's value is updated
    multiple times in the same day, the existing row is overwritten rather than
    creating duplicates — keeping the history clean for charting.

    card_type is a string discriminator ('wrestling' or 'soccer') so a single
    table can hold history for both card types without requiring nullable FKs.
    """
    __tablename__ = "value_history"
    id          = db.Column(db.Integer, primary_key=True)
    card_type   = db.Column(db.String(20), nullable=False)  # 'wrestling' or 'soccer'
    card_id     = db.Column(db.Integer, nullable=False)
    value       = db.Column(db.Float, nullable=False)
    recorded_at = db.Column(db.Date, default=date.today)

    # Composite index speeds up per-card history lookups, which is the most
    # frequent query pattern when rendering charts.
    __table_args__ = (
        db.Index("idx_history_card", "card_type", "card_id"),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def redistribute_box_costs(box_id):
    """Split box.cost evenly across non-base cards linked to this box.
    Base cards are tracked for inventory purposes but assigned $0 cost —
    the assumption is that boxes are purchased chasing hits, not base cards."""
    if not box_id:
        return
    box = Box.query.get(box_id)
    if not box:
        return
    w_cards = WrestlingCard.query.filter_by(box_id=box_id).all()
    s_cards = SoccerCard.query.filter_by(box_id=box_id).all()
    all_cards = w_cards + s_cards
    hits = [c for c in all_cards if (c.card_type or "").strip().lower() != "base"]
    base = [c for c in all_cards if (c.card_type or "").strip().lower() == "base"]
    per_card = round(box.cost / len(hits), 2) if hits else 0
    for c in hits:
        c.cost = per_card
    for c in base:
        c.cost = 0.0


def record_history(card_type, card_id, value):
    """Upsert a value snapshot for today. One row per card per day."""
    today = date.today()
    existing = ValueHistory.query.filter_by(
        card_type=card_type, card_id=card_id, recorded_at=today
    ).first()
    if existing:
        existing.value = value
    else:
        db.session.add(ValueHistory(card_type=card_type, card_id=card_id, value=value))


def wrestling_to_dict(c):
    """Serialize a WrestlingCard to a JSON-safe dict."""
    return {
        "id": c.id, "type": "wrestling",
        "wrestler_name": c.wrestler_name,
        "set_name": c.set_name or "",
        "brand": c.brand or "",
        "card_type": c.card_type or "",
        "card_number": c.card_number or "",
        "cost": c.cost,
        "current_value": c.current_value,
        "source": c.source or "Single",
        "box_id": c.box_id,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def soccer_to_dict(c):
    """Serialize a SoccerCard to a JSON-safe dict."""
    return {
        "id": c.id, "type": "soccer",
        "player_name": c.player_name,
        "set_name": c.set_name or "",
        "team": c.team or "",
        "league": c.league or "",
        "card_type": c.card_type or "",
        "card_number": c.card_number or "",
        "year": c.year or "",
        "cost": c.cost,
        "current_value": c.current_value,
        "source": c.source or "Single",
        "box_id": c.box_id,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def box_to_dict(b):
    """Serialize a Box with live card stats (count and current value of linked cards)."""
    w_cards = WrestlingCard.query.filter_by(box_id=b.id)
    s_cards = SoccerCard.query.filter_by(box_id=b.id)
    card_count  = w_cards.count() + s_cards.count()
    total_value = (db.session.query(db.func.sum(WrestlingCard.current_value)).filter_by(box_id=b.id).scalar() or 0) \
                + (db.session.query(db.func.sum(SoccerCard.current_value)).filter_by(box_id=b.id).scalar() or 0)
    # Suggested cost per card = box cost divided by how many cards are already linked.
    # When adding the next card the caller should use card_count + 1 as the divisor.
    return {
        "id": b.id, "name": b.name, "box_type": b.box_type or "",
        "cost": b.cost, "notes": b.notes or "",
        "created_at": b.created_at.isoformat() if b.created_at else "",
        "card_count": card_count,
        "total_value": round(total_value, 2),
    }


# ---------------------------------------------------------------------------
# Routes — Wrestling
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/wrestling", methods=["GET"])
def list_wrestling():
    """
    Return a paginated, filtered, sorted list of wrestling cards.
    Also returns total cost and value across ALL wrestling cards (not just
    the current page) so the summary bar stays accurate while filtering.
    """
    q         = request.args.get("q", "").strip()
    set_name  = request.args.get("set_name", "").strip()
    brand     = request.args.get("brand", "").strip()
    card_type = request.args.get("card_type", "").strip()
    sort      = request.args.get("sort", "wrestler_name")
    direction = request.args.get("dir", "asc")
    page      = int(request.args.get("page", 1))
    per_page  = int(request.args.get("per_page", 50))

    query = WrestlingCard.query
    if q:
        query = query.filter(WrestlingCard.wrestler_name.ilike(f"%{q}%"))
    if set_name:
        query = query.filter(WrestlingCard.set_name.ilike(f"%{set_name}%"))
    if brand:
        query = query.filter(WrestlingCard.brand.ilike(f"%{brand}%"))
    if card_type:
        query = query.filter(WrestlingCard.card_type.ilike(f"%{card_type}%"))

    col_map = {
        "wrestler_name": WrestlingCard.wrestler_name,
        "set_name":      WrestlingCard.set_name,
        "brand":         WrestlingCard.brand,
        "card_type":     WrestlingCard.card_type,
        "card_number":   WrestlingCard.card_number,
        "cost":          WrestlingCard.cost,
        "current_value": WrestlingCard.current_value,
    }
    col = col_map.get(sort, WrestlingCard.wrestler_name)
    query = query.order_by(col.desc() if direction == "desc" else col.asc())

    pagination  = query.paginate(page=page, per_page=per_page, error_out=False)
    total_cost  = db.session.query(db.func.sum(WrestlingCard.cost)).scalar() or 0
    total_value = db.session.query(db.func.sum(WrestlingCard.current_value)).scalar() or 0

    return jsonify({
        "cards":       [wrestling_to_dict(c) for c in pagination.items],
        "total":       pagination.total,
        "pages":       pagination.pages,
        "page":        page,
        "total_cost":  round(total_cost, 2),
        "total_value": round(total_value, 2),
    })


@app.route("/api/wrestling", methods=["POST"])
def create_wrestling():
    """Add a new wrestling card and record its initial value in history."""
    d = request.json
    c = WrestlingCard(
        wrestler_name=d["wrestler_name"],
        set_name=d.get("set_name", ""),
        brand=d.get("brand", ""),
        card_type=d.get("card_type", ""),
        card_number=d.get("card_number", ""),
        cost=float(d.get("cost", 0)),
        current_value=float(d.get("current_value", 0)),
        source=d.get("source", "Single"),
        box_id=int(d["box_id"]) if d.get("box_id") else None,
        notes=d.get("notes", ""),
    )
    db.session.add(c)
    # flush() assigns the auto-increment ID before commit so record_history
    # can reference it within the same transaction.
    db.session.flush()
    record_history("wrestling", c.id, c.current_value)
    redistribute_box_costs(c.box_id)
    db.session.commit()
    return jsonify(wrestling_to_dict(c)), 201


@app.route("/api/wrestling/<int:card_id>", methods=["PUT"])
def update_wrestling(card_id):
    """
    Update a wrestling card. A new history snapshot is recorded only when
    current_value actually changes, avoiding redundant data points.
    """
    c = WrestlingCard.query.get_or_404(card_id)
    d = request.json
    c.wrestler_name = d.get("wrestler_name", c.wrestler_name)
    c.set_name      = d.get("set_name", c.set_name)
    c.brand         = d.get("brand", c.brand)
    c.card_type     = d.get("card_type", c.card_type)
    c.card_number   = d.get("card_number", c.card_number)
    c.cost          = float(d.get("cost", c.cost))
    new_value       = float(d.get("current_value", c.current_value))
    if new_value != c.current_value:
        c.current_value = new_value
        record_history("wrestling", c.id, new_value)
    old_box_id   = c.box_id
    c.source     = d.get("source", c.source)
    c.box_id     = int(d["box_id"]) if d.get("box_id") else (None if "box_id" in d else c.box_id)
    c.notes      = d.get("notes", c.notes)
    c.updated_at = datetime.utcnow()
    # Redistribute costs for both the old and new box in case the card moved between boxes
    redistribute_box_costs(c.box_id)
    if old_box_id and old_box_id != c.box_id:
        redistribute_box_costs(old_box_id)
    db.session.commit()
    return jsonify(wrestling_to_dict(c))


@app.route("/api/wrestling/<int:card_id>", methods=["DELETE"])
def delete_wrestling(card_id):
    """Delete a card and all of its value history."""
    c = WrestlingCard.query.get_or_404(card_id)
    box_id = c.box_id
    ValueHistory.query.filter_by(card_type="wrestling", card_id=card_id).delete()
    db.session.delete(c)
    db.session.flush()
    redistribute_box_costs(box_id)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/wrestling/<int:card_id>/history")
def wrestling_history(card_id):
    """Return the full value history for a single wrestling card, oldest first."""
    rows = ValueHistory.query.filter_by(card_type="wrestling", card_id=card_id)\
        .order_by(ValueHistory.recorded_at).all()
    return jsonify([{"date": r.recorded_at.isoformat(), "value": r.value} for r in rows])


# ---------------------------------------------------------------------------
# Routes — Soccer
# ---------------------------------------------------------------------------

@app.route("/api/soccer", methods=["GET"])
def list_soccer():
    """
    Return a paginated, filtered, sorted list of soccer cards.
    Mirrors the wrestling endpoint — see list_wrestling() for full comments.
    """
    q         = request.args.get("q", "").strip()
    set_name  = request.args.get("set_name", "").strip()
    team      = request.args.get("team", "").strip()
    card_type = request.args.get("card_type", "").strip()
    sort      = request.args.get("sort", "player_name")
    direction = request.args.get("dir", "asc")
    page      = int(request.args.get("page", 1))
    per_page  = int(request.args.get("per_page", 50))

    query = SoccerCard.query
    if q:
        query = query.filter(SoccerCard.player_name.ilike(f"%{q}%"))
    if set_name:
        query = query.filter(SoccerCard.set_name.ilike(f"%{set_name}%"))
    if team:
        query = query.filter(SoccerCard.team.ilike(f"%{team}%"))
    if card_type:
        query = query.filter(SoccerCard.card_type.ilike(f"%{card_type}%"))

    col_map = {
        "player_name":   SoccerCard.player_name,
        "set_name":      SoccerCard.set_name,
        "team":          SoccerCard.team,
        "league":        SoccerCard.league,
        "card_type":     SoccerCard.card_type,
        "year":          SoccerCard.year,
        "cost":          SoccerCard.cost,
        "current_value": SoccerCard.current_value,
    }
    col = col_map.get(sort, SoccerCard.player_name)
    query = query.order_by(col.desc() if direction == "desc" else col.asc())

    pagination  = query.paginate(page=page, per_page=per_page, error_out=False)
    total_cost  = db.session.query(db.func.sum(SoccerCard.cost)).scalar() or 0
    total_value = db.session.query(db.func.sum(SoccerCard.current_value)).scalar() or 0

    return jsonify({
        "cards":       [soccer_to_dict(c) for c in pagination.items],
        "total":       pagination.total,
        "pages":       pagination.pages,
        "page":        page,
        "total_cost":  round(total_cost, 2),
        "total_value": round(total_value, 2),
    })


@app.route("/api/soccer", methods=["POST"])
def create_soccer():
    """Add a new soccer card and record its initial value in history."""
    d = request.json
    c = SoccerCard(
        player_name=d["player_name"],
        set_name=d.get("set_name", ""),
        team=d.get("team", ""),
        league=d.get("league", ""),
        card_type=d.get("card_type", ""),
        card_number=d.get("card_number", ""),
        year=int(d["year"]) if d.get("year") else None,
        cost=float(d.get("cost", 0)),
        current_value=float(d.get("current_value", 0)),
        source=d.get("source", "Single"),
        box_id=int(d["box_id"]) if d.get("box_id") else None,
        notes=d.get("notes", ""),
    )
    db.session.add(c)
    db.session.flush()
    record_history("soccer", c.id, c.current_value)
    redistribute_box_costs(c.box_id)
    db.session.commit()
    return jsonify(soccer_to_dict(c)), 201


@app.route("/api/soccer/<int:card_id>", methods=["PUT"])
def update_soccer(card_id):
    """Update a soccer card. Records a new history snapshot only on value change."""
    c = SoccerCard.query.get_or_404(card_id)
    d = request.json
    c.player_name = d.get("player_name", c.player_name)
    c.set_name    = d.get("set_name", c.set_name)
    c.team        = d.get("team", c.team)
    c.league      = d.get("league", c.league)
    c.card_type   = d.get("card_type", c.card_type)
    c.card_number = d.get("card_number", c.card_number)
    c.year        = int(d["year"]) if d.get("year") else c.year
    c.cost        = float(d.get("cost", c.cost))
    new_value     = float(d.get("current_value", c.current_value))
    if new_value != c.current_value:
        c.current_value = new_value
        record_history("soccer", c.id, new_value)
    old_box_id   = c.box_id
    c.source     = d.get("source", c.source)
    c.box_id     = int(d["box_id"]) if d.get("box_id") else (None if "box_id" in d else c.box_id)
    c.notes      = d.get("notes", c.notes)
    c.updated_at = datetime.utcnow()
    redistribute_box_costs(c.box_id)
    if old_box_id and old_box_id != c.box_id:
        redistribute_box_costs(old_box_id)
    db.session.commit()
    return jsonify(soccer_to_dict(c))


@app.route("/api/soccer/<int:card_id>", methods=["DELETE"])
def delete_soccer(card_id):
    """Delete a card and all of its value history."""
    c = SoccerCard.query.get_or_404(card_id)
    box_id = c.box_id
    ValueHistory.query.filter_by(card_type="soccer", card_id=card_id).delete()
    db.session.delete(c)
    db.session.flush()
    redistribute_box_costs(box_id)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/soccer/<int:card_id>/history")
def soccer_history(card_id):
    """Return the full value history for a single soccer card, oldest first."""
    rows = ValueHistory.query.filter_by(card_type="soccer", card_id=card_id)\
        .order_by(ValueHistory.recorded_at).all()
    return jsonify([{"date": r.recorded_at.isoformat(), "value": r.value} for r in rows])


# ---------------------------------------------------------------------------
# Routes — Portfolio & Utilities
# ---------------------------------------------------------------------------

@app.route("/api/portfolio/history")
def portfolio_history():
    """
    Return aggregate daily value totals for the portfolio chart.
    Groups all history rows by date and card_type, then merges them into a
    single list of {date, wrestling, soccer, total} objects suitable for
    Chart.js datasets.
    """
    card_type = request.args.get("type", "all")
    rows = db.session.query(
        ValueHistory.recorded_at,
        ValueHistory.card_type,
        db.func.sum(ValueHistory.value).label("total")
    )
    if card_type != "all":
        rows = rows.filter(ValueHistory.card_type == card_type)
    rows = rows.group_by(ValueHistory.recorded_at, ValueHistory.card_type)\
               .order_by(ValueHistory.recorded_at).all()

    # Pivot into {date: {wrestling: N, soccer: N}} then flatten to a list
    by_date = {}
    for row in rows:
        d = row.recorded_at.isoformat()
        if d not in by_date:
            by_date[d] = {"wrestling": 0, "soccer": 0}
        by_date[d][row.card_type] = round(row.total, 2)

    result = []
    for d in sorted(by_date.keys()):
        result.append({
            "date": d,
            **by_date[d],
            "total": round(by_date[d]["wrestling"] + by_date[d]["soccer"], 2)
        })
    return jsonify(result)


@app.route("/api/export/<card_type>")
def export_csv(card_type):
    """Stream a CSV download of all cards for the given type."""
    si = io.StringIO()
    if card_type == "wrestling":
        writer = csv.writer(si)
        writer.writerow(["ID", "Wrestler Name", "Set", "Brand", "Card Type", "Card Number",
                         "Cost", "Value", "Notes", "Created At"])
        for c in WrestlingCard.query.order_by(WrestlingCard.wrestler_name).all():
            writer.writerow([c.id, c.wrestler_name, c.set_name, c.brand, c.card_type, c.card_number,
                             c.cost, c.current_value, c.notes, c.created_at.date()])
        filename = "wrestling_cards.csv"
    elif card_type == "soccer":
        writer = csv.writer(si)
        writer.writerow(["ID", "Player Name", "Set", "Team", "League", "Card Type", "Card Number",
                         "Year", "Cost", "Value", "Notes", "Created At"])
        for c in SoccerCard.query.order_by(SoccerCard.player_name).all():
            writer.writerow([c.id, c.player_name, c.set_name, c.team, c.league, c.card_type, c.card_number,
                             c.year, c.cost, c.current_value, c.notes, c.created_at.date()])
        filename = "soccer_cards.csv"
    else:
        abort(404)

    output = io.BytesIO()
    output.write(si.getvalue().encode("utf-8"))
    output.seek(0)
    return send_file(output, mimetype="text/csv", as_attachment=True, download_name=filename)


@app.route("/api/import/<card_type>", methods=["POST"])
def import_csv(card_type):
    """
    Bulk-import cards from a CSV file. The CSV must use the same column headers
    produced by the export endpoint. Existing cards are not deduplicated —
    importing the same file twice will create duplicates.
    """
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file"}), 400

    stream = io.StringIO(f.stream.read().decode("utf-8"))
    reader = csv.DictReader(stream)
    count = 0

    if card_type == "wrestling":
        for row in reader:
            c = WrestlingCard(
                wrestler_name=row.get("Wrestler Name", ""),
                set_name=row.get("Set", ""),
                brand=row.get("Brand", ""),
                card_type=row.get("Card Type", ""),
                card_number=row.get("Card Number", ""),
                cost=float(row.get("Cost", 0) or 0),
                current_value=float(row.get("Value", 0) or 0),
                notes=row.get("Notes", ""),
            )
            db.session.add(c)
            db.session.flush()
            record_history("wrestling", c.id, c.current_value)
            count += 1
    elif card_type == "soccer":
        for row in reader:
            c = SoccerCard(
                player_name=row.get("Player Name", ""),
                set_name=row.get("Set", ""),
                team=row.get("Team", ""),
                league=row.get("League", ""),
                card_type=row.get("Card Type", ""),
                card_number=row.get("Card Number", ""),
                year=int(row["Year"]) if row.get("Year") else None,
                cost=float(row.get("Cost", 0) or 0),
                current_value=float(row.get("Value", 0) or 0),
                notes=row.get("Notes", ""),
            )
            db.session.add(c)
            db.session.flush()
            record_history("soccer", c.id, c.current_value)
            count += 1

    db.session.commit()
    return jsonify({"imported": count})


# ---------------------------------------------------------------------------
# Routes — Boxes
# ---------------------------------------------------------------------------

@app.route("/api/boxes", methods=["GET"])
def list_boxes():
    """Return all boxes with live card stats for the portfolio view."""
    boxes = Box.query.order_by(Box.created_at.desc()).all()
    return jsonify([box_to_dict(b) for b in boxes])


@app.route("/api/boxes", methods=["POST"])
def create_box():
    d = request.json
    b = Box(
        name=d["name"],
        box_type=d.get("box_type", ""),
        cost=float(d.get("cost", 0)),
        notes=d.get("notes", ""),
    )
    db.session.add(b)
    db.session.commit()
    return jsonify(box_to_dict(b)), 201


@app.route("/api/boxes/<int:box_id>", methods=["PUT"])
def update_box(box_id):
    b = Box.query.get_or_404(box_id)
    d = request.json
    b.name     = d.get("name", b.name)
    b.box_type = d.get("box_type", b.box_type)
    b.cost     = float(d.get("cost", b.cost))
    b.notes    = d.get("notes", b.notes)
    # Re-split the updated cost across all linked cards
    redistribute_box_costs(b.id)
    db.session.commit()
    return jsonify(box_to_dict(b))


@app.route("/api/boxes/<int:box_id>", methods=["DELETE"])
def delete_box(box_id):
    """Delete a box but keep its cards — just unlinks them (box_id → NULL)."""
    b = Box.query.get_or_404(box_id)
    WrestlingCard.query.filter_by(box_id=box_id).update({"box_id": None, "source": "Single"})
    SoccerCard.query.filter_by(box_id=box_id).update({"box_id": None, "source": "Single"})
    db.session.delete(b)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/stats")
def stats():
    """Return card counts and total cost/value for both collections."""
    w_count = WrestlingCard.query.count()
    w_cost  = db.session.query(db.func.sum(WrestlingCard.cost)).scalar() or 0
    w_value = db.session.query(db.func.sum(WrestlingCard.current_value)).scalar() or 0
    s_count = SoccerCard.query.count()
    s_cost  = db.session.query(db.func.sum(SoccerCard.cost)).scalar() or 0
    s_value = db.session.query(db.func.sum(SoccerCard.current_value)).scalar() or 0
    return jsonify({
        "wrestling": {"count": w_count, "cost": round(w_cost, 2), "value": round(w_value, 2)},
        "soccer":    {"count": s_count, "cost": round(s_cost, 2), "value": round(s_value, 2)},
        "total": {
            "count": w_count + s_count,
            "cost":  round(w_cost + s_cost, 2),
            "value": round(w_value + s_value, 2),
        }
    })


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        # Add set_name column to existing databases that predate this field.
        # SQLite supports ALTER TABLE ADD COLUMN but not IF NOT EXISTS, so we
        # check the schema manually first.
        with db.engine.connect() as conn:
            for table in ("wrestling_cards", "soccer_cards"):
                existing = [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))]
                if "set_name" not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN set_name VARCHAR(200)"))
                if "source" not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN source VARCHAR(50) DEFAULT 'Single'"))
                if "box_id" not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN box_id INTEGER REFERENCES boxes(id)"))
            conn.commit()
    app.run(debug=True, port=5000)
