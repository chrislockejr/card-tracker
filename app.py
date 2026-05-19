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
    quantity      = db.Column(db.Integer, default=1)
    status        = db.Column(db.String(20), default="active")  # 'active' or 'sold'
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
    quantity      = db.Column(db.Integer, default=1)
    status        = db.Column(db.String(20), default="active")
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


class Break(db.Model):
    """A card break event (e.g. a Whatnot stream). Tracks slots sold and links to
    the box purchases that were opened during the break."""
    __tablename__ = "breaks"
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(200), nullable=False)
    platform      = db.Column(db.String(100), default="Whatnot")
    break_date    = db.Column(db.Date, default=date.today)
    platform_fees = db.Column(db.Float, default=0.0)  # Whatnot/platform cut in dollars
    notes         = db.Column(db.Text)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    slots         = db.relationship("BreakSlot", backref="break_event", lazy="dynamic", cascade="all, delete-orphan")
    linked_boxes  = db.relationship("BreakBox", backref="break_event", lazy="dynamic", cascade="all, delete-orphan")


class BreakBox(db.Model):
    """Junction table linking a Break to one or more Box purchases."""
    __tablename__ = "break_boxes"
    id       = db.Column(db.Integer, primary_key=True)
    break_id = db.Column(db.Integer, db.ForeignKey("breaks.id"), nullable=False)
    box_id   = db.Column(db.Integer, db.ForeignKey("boxes.id"), nullable=False)


class BreakSlot(db.Model):
    """A single slot sold during a break — one buyer, one price.
    Fees are stored per-slot because each Whatnot transaction has its own
    processing charge (8% seller fee + 2.9% processing + $0.30 flat)."""
    __tablename__ = "break_slots"
    id         = db.Column(db.Integer, primary_key=True)
    break_id   = db.Column(db.Integer, db.ForeignKey("breaks.id"), nullable=False)
    slot_name  = db.Column(db.String(200))   # e.g. "Team USA", "Random #7"
    buyer_name = db.Column(db.String(200))
    price      = db.Column(db.Float, nullable=False)
    fees       = db.Column(db.Float, default=0.0)
    notes      = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class BoxProduct(db.Model):
    """A box product being price-tracked across retailers (e.g. Topps Chrome WWE 2026 Blaster).
    Separate from Box, which represents an actual purchase."""
    __tablename__ = "box_products"
    id       = db.Column(db.Integer, primary_key=True)
    name     = db.Column(db.String(200), nullable=False)
    box_type = db.Column(db.String(50))
    notes    = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    prices   = db.relationship("BoxPrice", backref="product", lazy="dynamic", cascade="all, delete-orphan")


class BoxPrice(db.Model):
    """A single price observation for a box product at a specific retailer on a specific date."""
    __tablename__ = "box_prices"
    id           = db.Column(db.Integer, primary_key=True)
    product_id   = db.Column(db.Integer, db.ForeignKey("box_products.id"), nullable=False)
    retailer     = db.Column(db.String(100), nullable=False)
    price        = db.Column(db.Float, nullable=False)
    url          = db.Column(db.Text)
    checked_date = db.Column(db.Date, default=date.today)
    notes        = db.Column(db.Text)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)


class Expense(db.Model):
    """A supply or overhead cost (sleeves, mailers, shipping materials, etc.)."""
    __tablename__ = "expenses"
    id           = db.Column(db.Integer, primary_key=True)
    category     = db.Column(db.String(100), nullable=False)  # Sleeves, Mailers, Shipping, etc.
    description  = db.Column(db.String(200))
    amount       = db.Column(db.Float, nullable=False)
    expense_date = db.Column(db.Date, default=date.today)
    notes        = db.Column(db.Text)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)


class Sale(db.Model):
    """Permanent record of a completed card sale. Stores a snapshot of the card
    at time of sale so the record stays accurate even if the card is later edited."""
    __tablename__ = "sales"
    id          = db.Column(db.Integer, primary_key=True)
    card_type   = db.Column(db.String(20), nullable=False)   # 'wrestling' or 'soccer'
    card_id     = db.Column(db.Integer, nullable=True)        # reference to original card (nullable — card may be deleted later)
    # Card snapshot — what was sold
    name        = db.Column(db.String(200))
    set_name    = db.Column(db.String(200))
    card_detail = db.Column(db.String(200))  # "Brand · Type" or "Team · League"
    card_number = db.Column(db.String(50))
    source      = db.Column(db.String(50))
    cost        = db.Column(db.Float, default=0.0)   # cost basis at time of sale
    # Sale details
    sold_price  = db.Column(db.Float, nullable=False)
    fees        = db.Column(db.Float, default=0.0)
    platform    = db.Column(db.String(100))
    sold_date   = db.Column(db.Date, default=date.today)
    notes       = db.Column(db.Text)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)


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
    # Only active cards share the cost — sold cards keep their cost basis fixed.
    w_cards = WrestlingCard.query.filter_by(box_id=box_id, status="active").all()
    s_cards = SoccerCard.query.filter_by(box_id=box_id, status="active").all()
    all_cards = w_cards + s_cards
    hits = [c for c in all_cards if (c.card_type or "").strip().lower() != "base"]
    base = [c for c in all_cards if (c.card_type or "").strip().lower() == "base"]
    # Divide box cost by total individual cards (sum of quantities), not entry count,
    # so a quantity-2 entry costs the same per card as a quantity-1 entry.
    total_hit_cards = sum(c.quantity or 1 for c in hits)
    per_card = round(box.cost / total_hit_cards, 2) if total_hit_cards else 0
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
        "quantity": c.quantity or 1,
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
        "quantity": c.quantity or 1,
        "source": c.source or "Single",
        "box_id": c.box_id,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def sale_to_dict(s):
    return {
        "id": s.id, "card_type": s.card_type, "card_id": s.card_id,
        "name": s.name or "", "set_name": s.set_name or "",
        "card_detail": s.card_detail or "", "card_number": s.card_number or "",
        "source": s.source or "", "cost": s.cost,
        "sold_price": s.sold_price, "fees": s.fees,
        "net_profit": round(s.sold_price - s.fees - s.cost, 2),
        "platform": s.platform or "", "notes": s.notes or "",
        "sold_date": s.sold_date.isoformat() if s.sold_date else "",
        "created_at": s.created_at.isoformat() if s.created_at else "",
    }


def breakslot_to_dict(s):
    return {
        "id": s.id, "break_id": s.break_id,
        "slot_name": s.slot_name or "", "buyer_name": s.buyer_name or "",
        "price": s.price, "fees": s.fees,
        "net": round(s.price - s.fees, 2),
        "notes": s.notes or "",
        "created_at": s.created_at.isoformat() if s.created_at else "",
    }


def break_to_dict(b):
    """Serialize a Break with computed P&L from linked boxes and slots."""
    linked = b.linked_boxes.all()
    box_ids = [lb.box_id for lb in linked]
    boxes   = Box.query.filter(Box.id.in_(box_ids)).all() if box_ids else []
    box_cost = sum(bx.cost for bx in boxes)

    total_income = db.session.query(db.func.sum(BreakSlot.price))\
        .filter_by(break_id=b.id).scalar() or 0
    total_fees = db.session.query(db.func.sum(BreakSlot.fees))\
        .filter_by(break_id=b.id).scalar() or 0
    slot_count = b.slots.count()
    net = round(total_income - box_cost - total_fees, 2)

    return {
        "id": b.id, "name": b.name, "platform": b.platform or "",
        "break_date": b.break_date.isoformat() if b.break_date else "",
        "notes": b.notes or "",
        "created_at": b.created_at.isoformat() if b.created_at else "",
        "box_ids": box_ids,
        "box_names": [bx.name for bx in boxes],
        "box_cost": round(box_cost, 2),
        "total_income": round(total_income, 2),
        "total_fees": round(total_fees, 2),
        "slot_count": slot_count,
        "net": net,
    }


def boxprice_to_dict(p):
    return {
        "id": p.id, "product_id": p.product_id,
        "retailer": p.retailer, "price": p.price,
        "url": p.url or "", "notes": p.notes or "",
        "checked_date": p.checked_date.isoformat() if p.checked_date else "",
        "created_at": p.created_at.isoformat() if p.created_at else "",
    }


def boxproduct_to_dict(p):
    """Serialize a BoxProduct with a summary of the latest price per retailer."""
    all_prices = p.prices.order_by(BoxPrice.checked_date.desc(), BoxPrice.created_at.desc()).all()
    # Latest price per retailer
    seen = {}
    for bp in all_prices:
        if bp.retailer not in seen:
            seen[bp.retailer] = bp
    latest = list(seen.values())
    best = min(latest, key=lambda x: x.price) if latest else None
    return {
        "id": p.id, "name": p.name, "box_type": p.box_type or "",
        "notes": p.notes or "",
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "price_count": all_prices.__len__() if hasattr(all_prices, '__len__') else p.prices.count(),
        "retailer_count": len(seen),
        "best_price": best.price if best else None,
        "best_retailer": best.retailer if best else None,
        "last_checked": all_prices[0].checked_date.isoformat() if all_prices else None,
        "latest_by_retailer": [boxprice_to_dict(bp) for bp in latest],
    }


def expense_to_dict(e):
    return {
        "id": e.id, "category": e.category, "description": e.description or "",
        "amount": e.amount, "notes": e.notes or "",
        "expense_date": e.expense_date.isoformat() if e.expense_date else "",
        "created_at": e.created_at.isoformat() if e.created_at else "",
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

    query = WrestlingCard.query.filter_by(status="active")
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
    total_cost  = db.session.query(db.func.sum(WrestlingCard.cost * WrestlingCard.quantity)).filter_by(status="active").scalar() or 0
    total_value = db.session.query(db.func.sum(WrestlingCard.current_value * WrestlingCard.quantity)).filter_by(status="active").scalar() or 0

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
        quantity=max(1, int(d.get("quantity", 1))),
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
    c.quantity   = max(1, int(d.get("quantity", c.quantity or 1)))
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

    query = SoccerCard.query.filter_by(status="active")
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
    total_cost  = db.session.query(db.func.sum(SoccerCard.cost * SoccerCard.quantity)).filter_by(status="active").scalar() or 0
    total_value = db.session.query(db.func.sum(SoccerCard.current_value * SoccerCard.quantity)).filter_by(status="active").scalar() or 0

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
        quantity=max(1, int(d.get("quantity", 1))),
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
    c.quantity   = max(1, int(d.get("quantity", c.quantity or 1)))
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

    Cards are only snapshotted when their value changes, so a naive per-date
    sum would drop cards to zero on days they weren't updated. Instead we
    carry each card's last known value forward: we maintain a running dict
    of {card_id: (card_type, value)} and update it only when a new snapshot
    exists, then sum the whole dict for every date that appears in history.
    """
    card_type_filter = request.args.get("type", "all")

    query = db.session.query(
        ValueHistory.recorded_at,
        ValueHistory.card_type,
        ValueHistory.card_id,
        ValueHistory.value,
    )
    if card_type_filter != "all":
        query = query.filter(ValueHistory.card_type == card_type_filter)
    rows = query.order_by(ValueHistory.recorded_at, ValueHistory.card_id).all()

    if not rows:
        return jsonify([])

    # Group snapshots by date
    by_date = {}
    for r in rows:
        by_date.setdefault(r.recorded_at, []).append(r)

    # Walk dates in order, maintaining the last known value for every card.
    # On each date: update changed cards, then sum the full running dict.
    last_known = {}   # {card_id: (card_type, value)}
    result = []
    for d in sorted(by_date.keys()):
        for r in by_date[d]:
            last_known[r.card_id] = (r.card_type, r.value)
        totals = {"wrestling": 0.0, "soccer": 0.0}
        for ctype, val in last_known.values():
            totals[ctype] += val
        result.append({
            "date":      d.isoformat(),
            "wrestling": round(totals["wrestling"], 2),
            "soccer":    round(totals["soccer"], 2),
            "total":     round(totals["wrestling"] + totals["soccer"], 2),
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


@app.route("/api/wrestling/check-duplicate")
def wrestling_check_duplicate():
    """Exact-match lookup to detect duplicate cards before adding. All comparisons
    are case-insensitive. Returns any active cards matching all provided fields."""
    def norm(key):
        return request.args.get(key, "").strip().lower()
    name       = norm("wrestler_name")
    set_name   = norm("set_name")
    card_type  = norm("card_type")
    card_number = norm("card_number")
    if not name:
        return jsonify([])
    query = WrestlingCard.query.filter_by(status="active")\
        .filter(db.func.lower(WrestlingCard.wrestler_name) == name)
    if set_name:
        query = query.filter(db.func.lower(WrestlingCard.set_name) == set_name)
    if card_type:
        query = query.filter(db.func.lower(WrestlingCard.card_type) == card_type)
    if card_number:
        query = query.filter(db.func.lower(WrestlingCard.card_number) == card_number)
    return jsonify([wrestling_to_dict(c) for c in query.all()])


@app.route("/api/soccer/check-duplicate")
def soccer_check_duplicate():
    """Exact-match lookup to detect duplicate soccer cards before adding."""
    def norm(key):
        return request.args.get(key, "").strip().lower()
    name        = norm("player_name")
    set_name    = norm("set_name")
    card_type   = norm("card_type")
    card_number = norm("card_number")
    if not name:
        return jsonify([])
    query = SoccerCard.query.filter_by(status="active")\
        .filter(db.func.lower(SoccerCard.player_name) == name)
    if set_name:
        query = query.filter(db.func.lower(SoccerCard.set_name) == set_name)
    if card_type:
        query = query.filter(db.func.lower(SoccerCard.card_type) == card_type)
    if card_number:
        query = query.filter(db.func.lower(SoccerCard.card_number) == card_number)
    return jsonify([soccer_to_dict(c) for c in query.all()])


@app.route("/api/wrestling/options")
def wrestling_options():
    """Return distinct values for datalist fields, pulled from existing cards."""
    def distinct(col):
        return sorted(set(
            r[0] for r in db.session.query(col).filter(col != None, col != "").distinct().all()
        ))
    return jsonify({
        "set_name":  distinct(WrestlingCard.set_name),
        "brand":     distinct(WrestlingCard.brand),
        "card_type": distinct(WrestlingCard.card_type),
    })


@app.route("/api/soccer/options")
def soccer_options():
    """Return distinct values for datalist fields, pulled from existing cards."""
    def distinct(col):
        return sorted(set(
            r[0] for r in db.session.query(col).filter(col != None, col != "").distinct().all()
        ))
    return jsonify({
        "set_name":  distinct(SoccerCard.set_name),
        "team":      distinct(SoccerCard.team),
        "league":    distinct(SoccerCard.league),
        "card_type": distinct(SoccerCard.card_type),
    })


@app.route("/api/stats")
def stats():
    """Return card counts and total cost/value for both collections (active cards only)."""
    w_count = db.session.query(db.func.sum(WrestlingCard.quantity)).filter_by(status="active").scalar() or 0
    w_cost  = db.session.query(db.func.sum(WrestlingCard.cost * WrestlingCard.quantity)).filter_by(status="active").scalar() or 0
    w_value = db.session.query(db.func.sum(WrestlingCard.current_value * WrestlingCard.quantity)).filter_by(status="active").scalar() or 0
    s_count = db.session.query(db.func.sum(SoccerCard.quantity)).filter_by(status="active").scalar() or 0
    s_cost  = db.session.query(db.func.sum(SoccerCard.cost * SoccerCard.quantity)).filter_by(status="active").scalar() or 0
    s_value = db.session.query(db.func.sum(SoccerCard.current_value * SoccerCard.quantity)).filter_by(status="active").scalar() or 0
    return jsonify({
        "wrestling": {"count": w_count, "cost": round(w_cost, 2), "value": round(w_value, 2)},
        "soccer":    {"count": s_count, "cost": round(s_cost, 2), "value": round(s_value, 2)},
        "total": {
            "count": w_count + s_count,
            "cost":  round(w_cost + s_cost, 2),
            "value": round(w_value + s_value, 2),
        }
    })


# ---------------------------------------------------------------------------
# Routes — Sales ledger
# ---------------------------------------------------------------------------

@app.route("/api/sales", methods=["GET"])
def list_sales():
    """Return a paginated list of sales, optionally filtered by name or card type."""
    q         = request.args.get("q", "").strip()
    card_type = request.args.get("card_type", "").strip()
    sort      = request.args.get("sort", "sold_date")
    direction = request.args.get("dir", "desc")
    page      = int(request.args.get("page", 1))
    per_page  = int(request.args.get("per_page", 50))

    query = Sale.query
    if q:
        query = query.filter(Sale.name.ilike(f"%{q}%"))
    if card_type:
        query = query.filter(Sale.card_type == card_type)

    col_map = {
        "sold_date":  Sale.sold_date,
        "name":       Sale.name,
        "sold_price": Sale.sold_price,
        "fees":       Sale.fees,
        "cost":       Sale.cost,
        "platform":   Sale.platform,
    }
    col = col_map.get(sort, Sale.sold_date)
    query = query.order_by(col.desc() if direction == "desc" else col.asc())

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "sales": [sale_to_dict(s) for s in pagination.items],
        "total": pagination.total,
        "pages": pagination.pages,
        "page":  page,
    })


@app.route("/api/sales", methods=["POST"])
def create_sale():
    """Mark a card as sold: snapshot it into the sales ledger and set status='sold'."""
    d         = request.json
    card_type = d.get("card_type")
    card_id   = int(d.get("card_id"))

    if card_type == "wrestling":
        card        = WrestlingCard.query.get_or_404(card_id)
        name        = card.wrestler_name
        card_detail = " · ".join(filter(None, [card.brand, card.card_type]))
    else:
        card        = SoccerCard.query.get_or_404(card_id)
        name        = card.player_name
        card_detail = " · ".join(filter(None, [card.team, card.league]))

    sale = Sale(
        card_type   = card_type,
        card_id     = card_id,
        name        = name,
        set_name    = card.set_name,
        card_detail = card_detail,
        card_number = card.card_number,
        source      = card.source,
        cost        = card.cost,
        sold_price  = float(d.get("sold_price", 0)),
        fees        = float(d.get("fees", 0)),
        platform    = d.get("platform", ""),
        sold_date   = date.fromisoformat(d["sold_date"]) if d.get("sold_date") else date.today(),
        notes       = d.get("notes", ""),
    )
    db.session.add(sale)
    if (card.quantity or 1) > 1:
        # More copies remain — decrement quantity, card stays active
        card.quantity -= 1
        db.session.commit()
    else:
        # Last copy — mark as sold and redistribute box costs
        card.status = "sold"
        box_id = card.box_id
        db.session.flush()
        redistribute_box_costs(box_id)
        db.session.commit()
    return jsonify(sale_to_dict(sale)), 201


@app.route("/api/sales/<int:sale_id>", methods=["DELETE"])
def delete_sale(sale_id):
    """Unarchive a sale: restore the card to active status and delete the sale record."""
    s = Sale.query.get_or_404(sale_id)
    if s.card_id:
        card = WrestlingCard.query.get(s.card_id) if s.card_type == "wrestling" else SoccerCard.query.get(s.card_id)
        if card:
            card.status = "active"
            box_id = card.box_id
            db.session.delete(s)
            db.session.flush()
            redistribute_box_costs(box_id)
            db.session.commit()
            return jsonify({"ok": True})
    db.session.delete(s)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/sales/stats")
def sales_stats():
    """Realized P&L totals across all sales."""
    total_revenue = db.session.query(db.func.sum(Sale.sold_price)).scalar() or 0
    total_fees    = db.session.query(db.func.sum(Sale.fees)).scalar() or 0
    total_cost    = db.session.query(db.func.sum(Sale.cost)).scalar() or 0
    total_count   = Sale.query.count()
    return jsonify({
        "count":         total_count,
        "total_revenue": round(total_revenue, 2),
        "total_fees":    round(total_fees, 2),
        "total_cost":    round(total_cost, 2),
        "net_profit":    round(total_revenue - total_fees - total_cost, 2),
    })


# ---------------------------------------------------------------------------
# Routes — Expenses
# ---------------------------------------------------------------------------

@app.route("/api/expenses", methods=["GET"])
def list_expenses():
    expenses = Expense.query.order_by(Expense.expense_date.desc(), Expense.created_at.desc()).all()
    return jsonify([expense_to_dict(e) for e in expenses])


@app.route("/api/expenses", methods=["POST"])
def create_expense():
    d = request.json
    e = Expense(
        category     = d["category"],
        description  = d.get("description", ""),
        amount       = float(d["amount"]),
        expense_date = date.fromisoformat(d["expense_date"]) if d.get("expense_date") else date.today(),
        notes        = d.get("notes", ""),
    )
    db.session.add(e)
    db.session.commit()
    return jsonify(expense_to_dict(e)), 201


@app.route("/api/expenses/<int:expense_id>", methods=["PUT"])
def update_expense(expense_id):
    e = Expense.query.get_or_404(expense_id)
    d = request.json
    e.category     = d.get("category", e.category)
    e.description  = d.get("description", e.description)
    e.amount       = float(d.get("amount", e.amount))
    e.expense_date = date.fromisoformat(d["expense_date"]) if d.get("expense_date") else e.expense_date
    e.notes        = d.get("notes", e.notes)
    db.session.commit()
    return jsonify(expense_to_dict(e))


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
def delete_expense(expense_id):
    e = Expense.query.get_or_404(expense_id)
    db.session.delete(e)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/expenses/stats")
def expenses_stats():
    """Total spent per category and overall."""
    rows = db.session.query(
        Expense.category,
        db.func.sum(Expense.amount).label("total")
    ).group_by(Expense.category).order_by(db.func.sum(Expense.amount).desc()).all()
    grand_total = sum(r.total for r in rows)
    return jsonify({
        "by_category": [{"category": r.category, "total": round(r.total, 2)} for r in rows],
        "grand_total": round(grand_total, 2),
    })


# ---------------------------------------------------------------------------
# Routes — Breaks
# ---------------------------------------------------------------------------

def _sync_break_boxes(break_id, box_ids):
    """Replace the set of boxes linked to a break."""
    BreakBox.query.filter_by(break_id=break_id).delete()
    for box_id in (box_ids or []):
        db.session.add(BreakBox(break_id=break_id, box_id=int(box_id)))


@app.route("/api/breaks", methods=["GET"])
def list_breaks():
    breaks = Break.query.order_by(Break.break_date.desc(), Break.created_at.desc()).all()
    return jsonify([break_to_dict(b) for b in breaks])


@app.route("/api/breaks", methods=["POST"])
def create_break():
    d = request.json
    b = Break(
        name          = d["name"],
        platform      = d.get("platform", "Whatnot"),
        break_date    = date.fromisoformat(d["break_date"]) if d.get("break_date") else date.today(),
        platform_fees = float(d.get("platform_fees", 0)),
        notes         = d.get("notes", ""),
    )
    db.session.add(b)
    db.session.flush()
    _sync_break_boxes(b.id, d.get("box_ids", []))
    db.session.commit()
    return jsonify(break_to_dict(b)), 201


@app.route("/api/breaks/<int:break_id>", methods=["PUT"])
def update_break(break_id):
    b = Break.query.get_or_404(break_id)
    d = request.json
    b.name          = d.get("name", b.name)
    b.platform      = d.get("platform", b.platform)
    b.break_date    = date.fromisoformat(d["break_date"]) if d.get("break_date") else b.break_date
    b.platform_fees = float(d.get("platform_fees", b.platform_fees))
    b.notes         = d.get("notes", b.notes)
    _sync_break_boxes(b.id, d.get("box_ids", []))
    db.session.commit()
    return jsonify(break_to_dict(b))


@app.route("/api/breaks/<int:break_id>", methods=["DELETE"])
def delete_break(break_id):
    b = Break.query.get_or_404(break_id)
    db.session.delete(b)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/breaks/<int:break_id>/slots", methods=["GET"])
def list_break_slots(break_id):
    Break.query.get_or_404(break_id)
    slots = BreakSlot.query.filter_by(break_id=break_id)\
        .order_by(BreakSlot.created_at).all()
    return jsonify([breakslot_to_dict(s) for s in slots])


@app.route("/api/breaks/<int:break_id>/slots", methods=["POST"])
def create_break_slot(break_id):
    Break.query.get_or_404(break_id)
    d = request.json
    s = BreakSlot(
        break_id   = break_id,
        slot_name  = d.get("slot_name", ""),
        buyer_name = d.get("buyer_name", ""),
        price      = float(d["price"]),
        fees       = float(d.get("fees", 0)),
        notes      = d.get("notes", ""),
    )
    db.session.add(s)
    db.session.commit()
    return jsonify(breakslot_to_dict(s)), 201


@app.route("/api/break-slots/<int:slot_id>", methods=["PUT"])
def update_break_slot(slot_id):
    s = BreakSlot.query.get_or_404(slot_id)
    d = request.json
    s.slot_name  = d.get("slot_name", s.slot_name)
    s.buyer_name = d.get("buyer_name", s.buyer_name)
    s.price      = float(d.get("price", s.price))
    s.fees       = float(d.get("fees", s.fees))
    s.notes      = d.get("notes", s.notes)
    db.session.commit()
    return jsonify(breakslot_to_dict(s))


@app.route("/api/break-slots/<int:slot_id>", methods=["DELETE"])
def delete_break_slot(slot_id):
    s = BreakSlot.query.get_or_404(slot_id)
    db.session.delete(s)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/breaks/stats")
def breaks_stats():
    """Aggregate break P&L for the portfolio summary."""
    all_breaks   = Break.query.all()
    total_income   = db.session.query(db.func.sum(BreakSlot.price)).scalar() or 0
    total_fees     = db.session.query(db.func.sum(BreakSlot.fees)).scalar() or 0
    linked_box_ids = [lb.box_id for lb in BreakBox.query.all()]
    total_box_cost = db.session.query(db.func.sum(Box.cost))\
        .filter(Box.id.in_(linked_box_ids)).scalar() or 0 if linked_box_ids else 0
    net = round(total_income - total_box_cost - total_fees, 2)
    return jsonify({
        "break_count":     len(all_breaks),
        "total_income":    round(total_income, 2),
        "total_box_cost":  round(total_box_cost, 2),
        "total_fees":      round(total_fees, 2),
        "net":             net,
    })


# ---------------------------------------------------------------------------
# Routes — Box price tracker
# ---------------------------------------------------------------------------

@app.route("/api/box-products", methods=["GET"])
def list_box_products():
    products = BoxProduct.query.order_by(BoxProduct.name).all()
    return jsonify([boxproduct_to_dict(p) for p in products])


@app.route("/api/box-products", methods=["POST"])
def create_box_product():
    d = request.json
    p = BoxProduct(name=d["name"], box_type=d.get("box_type", ""), notes=d.get("notes", ""))
    db.session.add(p)
    db.session.commit()
    return jsonify(boxproduct_to_dict(p)), 201


@app.route("/api/box-products/<int:product_id>", methods=["PUT"])
def update_box_product(product_id):
    p = BoxProduct.query.get_or_404(product_id)
    d = request.json
    p.name     = d.get("name", p.name)
    p.box_type = d.get("box_type", p.box_type)
    p.notes    = d.get("notes", p.notes)
    db.session.commit()
    return jsonify(boxproduct_to_dict(p))


@app.route("/api/box-products/<int:product_id>", methods=["DELETE"])
def delete_box_product(product_id):
    p = BoxProduct.query.get_or_404(product_id)
    db.session.delete(p)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/box-products/<int:product_id>/prices", methods=["GET"])
def list_box_prices(product_id):
    BoxProduct.query.get_or_404(product_id)
    prices = BoxPrice.query.filter_by(product_id=product_id)\
        .order_by(BoxPrice.checked_date.desc(), BoxPrice.created_at.desc()).all()
    return jsonify([boxprice_to_dict(p) for p in prices])


@app.route("/api/box-products/<int:product_id>/prices", methods=["POST"])
def create_box_price(product_id):
    BoxProduct.query.get_or_404(product_id)
    d = request.json
    p = BoxPrice(
        product_id   = product_id,
        retailer     = d["retailer"],
        price        = float(d["price"]),
        url          = d.get("url", ""),
        checked_date = date.fromisoformat(d["checked_date"]) if d.get("checked_date") else date.today(),
        notes        = d.get("notes", ""),
    )
    db.session.add(p)
    db.session.commit()
    return jsonify(boxprice_to_dict(p)), 201


@app.route("/api/box-prices/<int:price_id>", methods=["DELETE"])
def delete_box_price(price_id):
    p = BoxPrice.query.get_or_404(price_id)
    db.session.delete(p)
    db.session.commit()
    return jsonify({"ok": True})


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
                if "status" not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN status VARCHAR(20) DEFAULT 'active'"))
                if "quantity" not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN quantity INTEGER DEFAULT 1"))
            # Add fees column to break_slots if missing
            existing_slots = [r[1] for r in conn.execute(text("PRAGMA table_info(break_slots)"))]
            if "fees" not in existing_slots:
                conn.execute(text("ALTER TABLE break_slots ADD COLUMN fees FLOAT DEFAULT 0.0"))
            conn.commit()
    app.run(debug=True, port=5000)
