import csv
import io
from datetime import date, datetime
from flask import Flask, render_template, request, jsonify, send_file, abort
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///cards.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)


# --- Models ---

class WrestlingCard(db.Model):
    __tablename__ = "wrestling_cards"
    id = db.Column(db.Integer, primary_key=True)
    wrestler_name = db.Column(db.String(200), nullable=False)
    brand = db.Column(db.String(100))
    card_type = db.Column(db.String(100))
    card_number = db.Column(db.String(50))
    cost = db.Column(db.Float, default=0.0)
    current_value = db.Column(db.Float, default=0.0)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    history = db.relationship("ValueHistory", backref="wrestling_card", lazy="dynamic",
                              primaryjoin="and_(ValueHistory.card_type=='wrestling', foreign(ValueHistory.card_id)==WrestlingCard.id)",
                              foreign_keys="[ValueHistory.card_id]")


class SoccerCard(db.Model):
    __tablename__ = "soccer_cards"
    id = db.Column(db.Integer, primary_key=True)
    player_name = db.Column(db.String(200), nullable=False)
    team = db.Column(db.String(100))
    league = db.Column(db.String(100))
    card_type = db.Column(db.String(100))
    card_number = db.Column(db.String(50))
    year = db.Column(db.Integer)
    cost = db.Column(db.Float, default=0.0)
    current_value = db.Column(db.Float, default=0.0)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ValueHistory(db.Model):
    __tablename__ = "value_history"
    id = db.Column(db.Integer, primary_key=True)
    card_type = db.Column(db.String(20), nullable=False)  # 'wrestling' or 'soccer'
    card_id = db.Column(db.Integer, nullable=False)
    value = db.Column(db.Float, nullable=False)
    recorded_at = db.Column(db.Date, default=date.today)

    __table_args__ = (
        db.Index("idx_history_card", "card_type", "card_id"),
    )


# --- Helpers ---

def record_history(card_type, card_id, value):
    today = date.today()
    existing = ValueHistory.query.filter_by(card_type=card_type, card_id=card_id, recorded_at=today).first()
    if existing:
        existing.value = value
    else:
        db.session.add(ValueHistory(card_type=card_type, card_id=card_id, value=value))


def wrestling_to_dict(c):
    return {
        "id": c.id, "type": "wrestling",
        "wrestler_name": c.wrestler_name, "brand": c.brand or "",
        "card_type": c.card_type or "", "card_number": c.card_number or "",
        "cost": c.cost, "current_value": c.current_value,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


def soccer_to_dict(c):
    return {
        "id": c.id, "type": "soccer",
        "player_name": c.player_name, "team": c.team or "",
        "league": c.league or "", "card_type": c.card_type or "",
        "card_number": c.card_number or "", "year": c.year or "",
        "cost": c.cost, "current_value": c.current_value,
        "notes": c.notes or "",
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }


# --- Routes ---

@app.route("/")
def index():
    return render_template("index.html")


# Wrestling CRUD
@app.route("/api/wrestling", methods=["GET"])
def list_wrestling():
    q = request.args.get("q", "").strip()
    brand = request.args.get("brand", "").strip()
    card_type = request.args.get("card_type", "").strip()
    sort = request.args.get("sort", "wrestler_name")
    direction = request.args.get("dir", "asc")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))

    query = WrestlingCard.query
    if q:
        query = query.filter(WrestlingCard.wrestler_name.ilike(f"%{q}%"))
    if brand:
        query = query.filter(WrestlingCard.brand.ilike(f"%{brand}%"))
    if card_type:
        query = query.filter(WrestlingCard.card_type.ilike(f"%{card_type}%"))

    col_map = {
        "wrestler_name": WrestlingCard.wrestler_name,
        "brand": WrestlingCard.brand,
        "card_type": WrestlingCard.card_type,
        "card_number": WrestlingCard.card_number,
        "cost": WrestlingCard.cost,
        "current_value": WrestlingCard.current_value,
    }
    col = col_map.get(sort, WrestlingCard.wrestler_name)
    query = query.order_by(col.desc() if direction == "desc" else col.asc())

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    total_cost = db.session.query(db.func.sum(WrestlingCard.cost)).scalar() or 0
    total_value = db.session.query(db.func.sum(WrestlingCard.current_value)).scalar() or 0

    return jsonify({
        "cards": [wrestling_to_dict(c) for c in pagination.items],
        "total": pagination.total,
        "pages": pagination.pages,
        "page": page,
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
    })


@app.route("/api/wrestling", methods=["POST"])
def create_wrestling():
    d = request.json
    c = WrestlingCard(
        wrestler_name=d["wrestler_name"],
        brand=d.get("brand", ""),
        card_type=d.get("card_type", ""),
        card_number=d.get("card_number", ""),
        cost=float(d.get("cost", 0)),
        current_value=float(d.get("current_value", 0)),
        notes=d.get("notes", ""),
    )
    db.session.add(c)
    db.session.flush()
    record_history("wrestling", c.id, c.current_value)
    db.session.commit()
    return jsonify(wrestling_to_dict(c)), 201


@app.route("/api/wrestling/<int:card_id>", methods=["PUT"])
def update_wrestling(card_id):
    c = WrestlingCard.query.get_or_404(card_id)
    d = request.json
    c.wrestler_name = d.get("wrestler_name", c.wrestler_name)
    c.brand = d.get("brand", c.brand)
    c.card_type = d.get("card_type", c.card_type)
    c.card_number = d.get("card_number", c.card_number)
    c.cost = float(d.get("cost", c.cost))
    new_value = float(d.get("current_value", c.current_value))
    if new_value != c.current_value:
        c.current_value = new_value
        record_history("wrestling", c.id, new_value)
    c.notes = d.get("notes", c.notes)
    c.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(wrestling_to_dict(c))


@app.route("/api/wrestling/<int:card_id>", methods=["DELETE"])
def delete_wrestling(card_id):
    c = WrestlingCard.query.get_or_404(card_id)
    ValueHistory.query.filter_by(card_type="wrestling", card_id=card_id).delete()
    db.session.delete(c)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/wrestling/<int:card_id>/history")
def wrestling_history(card_id):
    rows = ValueHistory.query.filter_by(card_type="wrestling", card_id=card_id)\
        .order_by(ValueHistory.recorded_at).all()
    return jsonify([{"date": r.recorded_at.isoformat(), "value": r.value} for r in rows])


# Soccer CRUD
@app.route("/api/soccer", methods=["GET"])
def list_soccer():
    q = request.args.get("q", "").strip()
    team = request.args.get("team", "").strip()
    card_type = request.args.get("card_type", "").strip()
    sort = request.args.get("sort", "player_name")
    direction = request.args.get("dir", "asc")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 50))

    query = SoccerCard.query
    if q:
        query = query.filter(SoccerCard.player_name.ilike(f"%{q}%"))
    if team:
        query = query.filter(SoccerCard.team.ilike(f"%{team}%"))
    if card_type:
        query = query.filter(SoccerCard.card_type.ilike(f"%{card_type}%"))

    col_map = {
        "player_name": SoccerCard.player_name,
        "team": SoccerCard.team,
        "league": SoccerCard.league,
        "card_type": SoccerCard.card_type,
        "year": SoccerCard.year,
        "cost": SoccerCard.cost,
        "current_value": SoccerCard.current_value,
    }
    col = col_map.get(sort, SoccerCard.player_name)
    query = query.order_by(col.desc() if direction == "desc" else col.asc())

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    total_cost = db.session.query(db.func.sum(SoccerCard.cost)).scalar() or 0
    total_value = db.session.query(db.func.sum(SoccerCard.current_value)).scalar() or 0

    return jsonify({
        "cards": [soccer_to_dict(c) for c in pagination.items],
        "total": pagination.total,
        "pages": pagination.pages,
        "page": page,
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
    })


@app.route("/api/soccer", methods=["POST"])
def create_soccer():
    d = request.json
    c = SoccerCard(
        player_name=d["player_name"],
        team=d.get("team", ""),
        league=d.get("league", ""),
        card_type=d.get("card_type", ""),
        card_number=d.get("card_number", ""),
        year=int(d["year"]) if d.get("year") else None,
        cost=float(d.get("cost", 0)),
        current_value=float(d.get("current_value", 0)),
        notes=d.get("notes", ""),
    )
    db.session.add(c)
    db.session.flush()
    record_history("soccer", c.id, c.current_value)
    db.session.commit()
    return jsonify(soccer_to_dict(c)), 201


@app.route("/api/soccer/<int:card_id>", methods=["PUT"])
def update_soccer(card_id):
    c = SoccerCard.query.get_or_404(card_id)
    d = request.json
    c.player_name = d.get("player_name", c.player_name)
    c.team = d.get("team", c.team)
    c.league = d.get("league", c.league)
    c.card_type = d.get("card_type", c.card_type)
    c.card_number = d.get("card_number", c.card_number)
    c.year = int(d["year"]) if d.get("year") else c.year
    c.cost = float(d.get("cost", c.cost))
    new_value = float(d.get("current_value", c.current_value))
    if new_value != c.current_value:
        c.current_value = new_value
        record_history("soccer", c.id, new_value)
    c.notes = d.get("notes", c.notes)
    c.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(soccer_to_dict(c))


@app.route("/api/soccer/<int:card_id>", methods=["DELETE"])
def delete_soccer(card_id):
    c = SoccerCard.query.get_or_404(card_id)
    ValueHistory.query.filter_by(card_type="soccer", card_id=card_id).delete()
    db.session.delete(c)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/soccer/<int:card_id>/history")
def soccer_history(card_id):
    rows = ValueHistory.query.filter_by(card_type="soccer", card_id=card_id)\
        .order_by(ValueHistory.recorded_at).all()
    return jsonify([{"date": r.recorded_at.isoformat(), "value": r.value} for r in rows])


# Portfolio history (aggregate daily totals)
@app.route("/api/portfolio/history")
def portfolio_history():
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

    by_date = {}
    for row in rows:
        d = row.recorded_at.isoformat()
        if d not in by_date:
            by_date[d] = {"wrestling": 0, "soccer": 0}
        by_date[d][row.card_type] = round(row.total, 2)

    result = []
    for d in sorted(by_date.keys()):
        result.append({"date": d, **by_date[d], "total": round(by_date[d]["wrestling"] + by_date[d]["soccer"], 2)})
    return jsonify(result)


# CSV Export
@app.route("/api/export/<card_type>")
def export_csv(card_type):
    si = io.StringIO()
    if card_type == "wrestling":
        writer = csv.writer(si)
        writer.writerow(["ID", "Wrestler Name", "Brand", "Card Type", "Card Number", "Cost", "Value", "Notes", "Created At"])
        for c in WrestlingCard.query.order_by(WrestlingCard.wrestler_name).all():
            writer.writerow([c.id, c.wrestler_name, c.brand, c.card_type, c.card_number,
                             c.cost, c.current_value, c.notes, c.created_at.date()])
        filename = "wrestling_cards.csv"
    elif card_type == "soccer":
        writer = csv.writer(si)
        writer.writerow(["ID", "Player Name", "Team", "League", "Card Type", "Card Number", "Year", "Cost", "Value", "Notes", "Created At"])
        for c in SoccerCard.query.order_by(SoccerCard.player_name).all():
            writer.writerow([c.id, c.player_name, c.team, c.league, c.card_type, c.card_number,
                             c.year, c.cost, c.current_value, c.notes, c.created_at.date()])
        filename = "soccer_cards.csv"
    else:
        abort(404)

    output = io.BytesIO()
    output.write(si.getvalue().encode("utf-8"))
    output.seek(0)
    return send_file(output, mimetype="text/csv", as_attachment=True, download_name=filename)


# CSV Import
@app.route("/api/import/<card_type>", methods=["POST"])
def import_csv(card_type):
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


# Stats
@app.route("/api/stats")
def stats():
    w_count = WrestlingCard.query.count()
    w_cost = db.session.query(db.func.sum(WrestlingCard.cost)).scalar() or 0
    w_value = db.session.query(db.func.sum(WrestlingCard.current_value)).scalar() or 0
    s_count = SoccerCard.query.count()
    s_cost = db.session.query(db.func.sum(SoccerCard.cost)).scalar() or 0
    s_value = db.session.query(db.func.sum(SoccerCard.current_value)).scalar() or 0
    return jsonify({
        "wrestling": {"count": w_count, "cost": round(w_cost, 2), "value": round(w_value, 2)},
        "soccer": {"count": s_count, "cost": round(s_cost, 2), "value": round(s_value, 2)},
        "total": {
            "count": w_count + s_count,
            "cost": round(w_cost + s_cost, 2),
            "value": round(w_value + s_value, 2),
        }
    })


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5000)
