from flask import Flask, render_template, request, jsonify, send_file
import numpy as np
from flask_sqlalchemy import SQLAlchemy
import json
import io
import os
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

app = Flask(__name__)

# --- DATABASE SETUP ---
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///optisolve_v2.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class SimplexHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.now)
    problem_name = db.Column(db.String(100))
    method_used = db.Column(db.String(20))
    c = db.Column(db.Text) 
    A = db.Column(db.Text)
    b = db.Column(db.Text)
    signs = db.Column(db.Text)
    is_min = db.Column(db.Boolean)
    solution = db.Column(db.Text)
    z_value = db.Column(db.Float)
    steps = db.Column(db.Text)
    headers = db.Column(db.Text)

with app.app_context():
    db.create_all()

# --- SOLVER LOGIC ---

def normalize_constraints(A, b, signs):
    """Step 1: Ensure RHS >= 0."""
    A = np.array(A, dtype=float)
    b = np.array(b, dtype=float)
    for i in range(len(b)):
        if b[i] < 0:
            b[i] *= -1
            A[i] *= -1
            if signs[i] == "<=": signs[i] = ">="
            elif signs[i] == ">=": signs[i] = "<="
    return A, b, signs

def solve_lpp(c_in, A_in, b_in, signs, is_min):
    # Normalize
    A, b, signs = normalize_constraints(A_in, b_in, signs)
    m, n = A.shape

    if n < m:
        return {"status": "Error", "message": "Number of constraints must be less than or equal to variables !!"}
    
    # --- Generate Standard Form (with M Penalities for Artificial Variables) ---
    sf_obj = "Minimize Z = " if is_min else "Maximize Z = "
    sf_obj += " + ".join([f"{c_in[j]}x{j+1}" for j in range(n)])
    
    sf_constraints = []
    s_c = 1
    a_c = 1
    for i in range(m):
        c_str = ""
        for j in range(n):
            term = f"{abs(A[i][j])}x{j+1}"
            if c_str == "":
                c_str = (f"-{term}" if A[i][j] < 0 else term)
            else:
                c_str += (f" - {term}" if A[i][j] < 0 else f" + {term}")
        
        if signs[i] == "<=":
            c_str += f" + s{s_c}"
            s_c += 1
        elif signs[i] == ">=":
            c_str += f" - s{s_c} + a{a_c}"
            sf_obj += f" + Ma{a_c}" if is_min else f" - Ma{a_c}"
            s_c += 1
            a_c += 1
        elif signs[i] == "=":
            c_str += f" + a{a_c}"
            sf_obj += f" + Ma{a_c}" if is_min else f" - Ma{a_c}"
            a_c += 1
        c_str += f" = {b[i]}"
        sf_constraints.append(c_str.strip())
        
    standard_form_text = sf_obj + "\nSubject To:\n" + "\n".join(sf_constraints)
    # --------------------------------------------------------------------------

    # Identify variables needed
    num_slack = signs.count("<=")
    num_surplus = signs.count(">=")
    num_art = signs.count(">=") + signs.count("=")
    method = "Simplex" if num_art == 0 else "Big-M"
    
    # Headers for UI/Tableau
    headers = [f"x{i+1}" for i in range(n)]
    headers += [f"s{i+1}" for i in range(num_slack + num_surplus)]
    headers += [f"a{i+1}" for i in range(num_art)]
    headers += ["RHS"]

    total_vars = n + num_slack + num_surplus + num_art
    tableau = np.zeros((m + 1, total_vars + 1))
    
    # M Penalty Constant
    M = 10**7
    
    # Setup Objective Row (Standardized to Maximization)
    c = np.array(c_in, dtype=float)
    if is_min:
        tableau[-1, :n] = c  # Z + cx = 0
    else:
        tableau[-1, :n] = -c # Z - cx = 0

    basis = []
    art_indices = []
    s_idx = n
    a_idx = n + num_slack + num_surplus

    # Build Constraints
    for i in range(m):
        tableau[i, :n] = A[i]
        tableau[i, -1] = b[i]
        
        if signs[i] == "<=":
            tableau[i, s_idx] = 1
            basis.append(s_idx)
            s_idx += 1
        elif signs[i] == ">=":
            tableau[i, s_idx] = -1 # Surplus
            tableau[i, a_idx] = 1  # Artificial
            tableau[-1, a_idx] = M # Penalty in Z row
            basis.append(a_idx)
            art_indices.append(a_idx)
            s_idx += 1
            a_idx += 1
        elif signs[i] == "=":
            tableau[i, a_idx] = 1
            tableau[-1, a_idx] = M
            basis.append(a_idx)
            art_indices.append(a_idx)
            a_idx += 1

    # Adjust Objective Row (Row transformation for Artificial Variables)
    for i, b_var in enumerate(basis):
        if b_var in art_indices:
            tableau[-1] -= M * tableau[i]

    steps = []
    
    # Pivot Loop
    for iteration in range(100):
        # Optimization check
        z_row = tableau[-1, :-1]
        if np.min(z_row) >= -1e-9:
            break
            
        pc = np.argmin(z_row)
        
        # Minimum Ratio Test
        ratios = []
        for i in range(m):
            if tableau[i, pc] > 1e-9:
                ratios.append(tableau[i, -1] / tableau[i, pc])
            else:
                ratios.append(np.inf)
        
        pr = np.argmin(ratios)
        if ratios[pr] == np.inf:
            return {"status": "Unbounded", "method": method, "steps": steps, "standard_form": standard_form_text}

        # Save Step before pivoting
        steps.append({
            "table": tableau.tolist(),
            "basis": [headers[i] for i in basis],
            "key_row": int(pr),
            "key_col": int(pc),
            "key_element": round(float(tableau[pr, pc]), 4),
            "explanation": f"Variable {headers[pc]} enters basis at Row {pr+1}."
        })

        # Pivot Operation
        pivot_val = tableau[pr, pc]
        tableau[pr] /= pivot_val
        for r in range(m + 1):
            if r != pr:
                tableau[r] -= tableau[r, pc] * tableau[pr]
        basis[pr] = pc

    # Final iteration
    steps.append({
        "table": tableau.tolist(),
        "basis": [headers[i] for i in basis],
        "key_row": None, "key_col": None,
        "explanation": "Optimal Solution Found."
    })

    # Check Infeasibility
    for i, b_var in enumerate(basis):
        if b_var in art_indices and tableau[i, -1] > 1e-6:
            return {"status": "Infeasible", "method": method, "steps": steps, "standard_form": standard_form_text}

    # Extract Results
    sol = [0.0] * n
    for i, b_var in enumerate(basis):
        if b_var < n:
            sol[b_var] = round(float(tableau[i, -1]), 4)
            
    final_z = sum(c_in[i] * sol[i] for i in range(n))

    # --- Generate Interpretation ---
    interp = f"The optimal solution yields a {'minimum' if is_min else 'maximum'} Z value of <strong>{round(float(final_z), 4)}</strong>. "
    interp += "The values of the decision variables to achieve this are: " + ", ".join([f"<strong>x{i+1} = {sol[i]}</strong>" for i in range(n)]) + ".<br><br>"
    
    binding = []
    non_binding = []
    for i in range(m):
        val = sum(A_in[i][j] * sol[j] for j in range(n))
        if abs(val - b_in[i]) < 1e-5:
            binding.append(str(i+1))
        else:
            non_binding.append(f"{i+1} (Slack/Surplus = {round(abs(val - b_in[i]), 4)})")
            
    if binding:
        interp += f"Constraints <strong>{', '.join(binding)}</strong> are binding (their full capacity is utilized or boundary is met).<br>"
    if non_binding:
        interp += f"Constraints <strong>{', '.join(non_binding)}</strong> are non-binding (there is unused resource or buffer).<br>"
    # -------------------------------

    return {
        "status": "Optimal",
        "method": method,
        "solution": sol,
        "z": round(float(final_z), 4),
        "steps": steps,
        "headers": headers,
        "standard_form": standard_form_text,
        "interpretation": interp,
        "plot_data": {
            "num_vars": n,
            "c": c_in,
            "A": A_in,
            "b": b_in,
            "signs": signs,
            "is_min": is_min
        }
    }

# --- ROUTES ---

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/solve", methods=["POST"])
def solve():
    try:
        data = request.json
        res = solve_lpp(data['c'], data['A'], data['b'], data['signs'], data['is_min'])
        
        if res['status'] == "Optimal":
            entry = SimplexHistory(
                problem_name=f"{'Min' if data['is_min'] else 'Max'} Problem",
                method_used=res['method'],
                c=json.dumps(data['c']), A=json.dumps(data['A']), b=json.dumps(data['b']),
                signs=json.dumps(data['signs']), is_min=data['is_min'],
                solution=json.dumps(res['solution']), z_value=res['z'],
                steps=json.dumps(res['steps']), headers=json.dumps(res['headers'])
            )
            # Temporarily store standard form and interpretation dynamically since they are not in DB
            res['saved_standard_form'] = res['standard_form']
            res['saved_interpretation'] = res['interpretation']
            db.session.add(entry)
            
            # History limit: 10
            if SimplexHistory.query.count() >= 10:
                oldest = SimplexHistory.query.order_by(SimplexHistory.timestamp.asc()).first()
                db.session.delete(oldest)
                
            db.session.commit()
            res['id'] = entry.id
            
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "Error", "message": str(e)}), 500

@app.route("/history", methods=["GET"])
def history():
    h = SimplexHistory.query.order_by(SimplexHistory.timestamp.desc()).all()
    return jsonify([{"id": x.id, "name": x.problem_name, "z": x.z_value, "method": x.method_used} for x in h])

@app.route("/history/delete/<int:hid>", methods=["DELETE"])
def delete_history_item(hid):
    try:
        item = SimplexHistory.query.get_or_404(hid)
        db.session.delete(item)
        db.session.commit()
        return jsonify({"status": "Success", "message": "Log deleted"})
    except Exception as e:
        return jsonify({"status": "Error", "message": str(e)}), 500

@app.route("/history/<int:hid>", methods=["GET"])
def get_history_detail(hid):
    h = SimplexHistory.query.get_or_404(hid)
    
    # Placeholder for Sensitivity Analysis logic
    sensitivity = [
        {"variable": f"Constraint {i+1}", "shadow_price": 0.00, "allowable_increase": "∞"}
        for i in range(len(json.loads(h.b)))
    ]

    return jsonify({
        "id": h.id,
        "name": h.problem_name,
        "method": h.method_used,
        "c": json.loads(h.c),
        "A": json.loads(h.A),
        "b": json.loads(h.b),
        "signs": json.loads(h.signs),
        "is_min": h.is_min,
        "solution": json.loads(h.solution),
        "z": h.z_value,
        "steps": json.loads(h.steps),
        "headers": json.loads(h.headers),
        "sensitivity": sensitivity, 
        "status": "Optimal"
    })

@app.route("/export-pdf/<int:hid>")
def pdf(hid):
    h = SimplexHistory.query.get_or_404(hid)
    
    steps = json.loads(h.steps)
    headers = json.loads(h.headers)
    c = json.loads(h.c)
    A = json.loads(h.A)
    b = json.loads(h.b)
    signs = json.loads(h.signs)
    solution = json.loads(h.solution)
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    elements = []
    
    # Date and Time
    current_time = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    elements.append(Paragraph(f"<i>Downloaded on: {current_time}</i>", styles['Normal']))
    elements.append(Spacer(1, 12))

    # Title
    elements.append(Paragraph(f"OptiSolve Report: {h.method_used} Method", styles['Title']))
    elements.append(Spacer(1, 15))

    # Problem Inputs Formulation
    elements.append(Paragraph("<b>Problem Formulation</b>", styles['Heading3']))
    obj_type = "Minimize" if h.is_min else "Maximize"
    obj_func = " + ".join([f"{val}x{i+1}" for i, val in enumerate(c)])
    elements.append(Paragraph(f"<b>Objective:</b> {obj_type} Z = {obj_func}", styles['Normal']))
    elements.append(Spacer(1, 6))
    
    elements.append(Paragraph("<b>Subject To:</b>", styles['Normal']))
    for i, row in enumerate(A):
        cons_expr = " + ".join([f"{val}x{j+1}" for j, val in enumerate(row)])
        elements.append(Paragraph(f"{cons_expr} {signs[i]} {b[i]}", styles['Normal']))
    elements.append(Spacer(1, 15))

    # Final Solution Overview
    elements.append(Paragraph("<b>Optimal Solution Overview</b>", styles['Heading3']))
    elements.append(Paragraph(f"<b>Z = {h.z_value:.4f}</b>", styles['Normal']))
    sol_text = ", ".join([f"x{i+1} = {val:.2f}" for i, val in enumerate(solution)])
    elements.append(Paragraph(f"Variables: {sol_text}", styles['Normal']))
    elements.append(Spacer(1, 20))

    # Iteration Tables
    elements.append(Paragraph("<b>Step-by-Step Iterations</b>", styles['Heading2']))
    
    for i, step in enumerate(steps):
        elements.append(Paragraph(f"<b>Iteration {i}:</b> {step['explanation']}", styles['Heading4']))
        
        data = [headers] + [[f"{val:.2f}" for val in row] for row in step['table']]
        t = Table(data)
        
        t_style = TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#475569")),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor("#e2e8f0"))
        ])

        key_row = step.get('key_row')
        key_col = step.get('key_col')

        if key_row is not None and key_col is not None and key_row >= 0 and key_col >= 0:
            actual_row = key_row + 1  
            key_element = step['table'][key_row][key_col]
            
            t_style.add('BACKGROUND', (0, actual_row), (-1, actual_row), colors.HexColor("#fefce8"))
            t_style.add('BACKGROUND', (key_col, 1), (key_col, -1), colors.HexColor("#eff6ff"))
            t_style.add('BACKGROUND', (key_col, actual_row), (key_col, actual_row), colors.HexColor("#fbbf24"))
            t_style.add('TEXTCOLOR', (key_col, actual_row), (key_col, actual_row), colors.white)
            t_style.add('FONTNAME', (key_col, actual_row), (key_col, actual_row), 'Helvetica-Bold')

            t.setStyle(t_style)
            elements.append(t)
            elements.append(Spacer(1, 6))
            
            pivot_text = f"<b>Pivot Row:</b> {key_row} | <b>Pivot Column:</b> {headers[key_col]} | <b>Pivot Element:</b> {key_element:.2f}"
            elements.append(Paragraph(pivot_text, styles['Normal']))
        else:
            t.setStyle(t_style)
            elements.append(t)
            
        elements.append(Spacer(1, 15))

    doc.build(elements)
    buffer.seek(0)
    
    filename = f"OptiSolve_Report_{h.id}.pdf"
    return send_file(buffer, as_attachment=True, download_name=filename, mimetype='application/pdf')

if __name__ == "__main__":
    app.run(debug=True)