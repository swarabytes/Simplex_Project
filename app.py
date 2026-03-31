import sys
import os

# --- AUTOMATIC ENVIRONMENT FIX ---
try:
    import cv2
except ImportError:
    if sys.version_info >= (3, 13):
        print("\n\n" + "="*80)
        print("ERROR: Unsupported Python version detected.")
        print("We must install Python 3.11 to fix this OpenCV error.")
        print("A permission window (User Account Control) will pop up shortly. ")
        print("PLEASE CLICK 'YES' TO ALLOW THE INSTALLATION!")
        print("="*80 + "\n\n")
        
        if os.path.exists("setup.bat"):
            print("Starting automated setup... PLEASE WAIT...")
            os.system("setup.bat")
            sys.exit(0)

from flask import Flask, render_template, request, jsonify, send_file
import numpy as np
from flask_sqlalchemy import SQLAlchemy
import json
import io
import base64
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from lpp_parser import LPPParser
from ocr_engine import HybridOCR
import traceback

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
    
    # --- Generate Standard Form ---
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
            # sf_obj += f" + Ma{a_c}" logic... (Omitted for brevity in this re-write block if not critical, but let's keep solver intact)
            s_c += 1
            a_c += 1
        elif signs[i] == "=":
            c_str += f" + a{a_c}"
            a_c += 1
        c_str += f" = {b[i]}"
        sf_constraints.append(c_str.strip())
        
    standard_form_text = sf_obj + "\nSubject To:\n" + "\n".join(sf_constraints)

    # Variables
    num_slack = signs.count("<=")
    num_surplus = signs.count(">=")
    num_art = signs.count(">=") + signs.count("=")
    method = "Simplex" if num_art == 0 else "Big-M"
    
    headers = [f"x{i+1}" for i in range(n)]
    headers += [f"s{i+1}" for i in range(num_slack + num_surplus)]
    headers += [f"a{i+1}" for i in range(num_art)]
    headers += ["RHS"]

    total_vars = n + num_slack + num_surplus + num_art
    tableau = np.zeros((m + 1, total_vars + 1))
    
    M = 10**7
    
    c = np.array(c_in, dtype=float)
    if is_min:
        tableau[-1, :n] = c  
    else:
        tableau[-1, :n] = -c 

    basis = []
    art_indices = []
    s_idx = n
    a_idx = n + num_slack + num_surplus

    for i in range(m):
        tableau[i, :n] = A[i]
        tableau[i, -1] = b[i]
        
        if signs[i] == "<=":
            tableau[i, s_idx] = 1
            basis.append(s_idx)
            s_idx += 1
        elif signs[i] == ">=":
            tableau[i, s_idx] = -1 
            tableau[i, a_idx] = 1  
            tableau[-1, a_idx] = M 
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

    for i, b_var in enumerate(basis):
        if b_var in art_indices:
            tableau[-1] -= M * tableau[i]

    steps = []
    
    for iteration in range(100):
        z_row = tableau[-1, :-1]
        if np.min(z_row) >= -1e-9:
            break
            
        pc = np.argmin(z_row)
        
        ratios = []
        for i in range(m):
            if tableau[i, pc] > 1e-9:
                ratios.append(tableau[i, -1] / tableau[i, pc])
            else:
                ratios.append(np.inf)
        
        pr = np.argmin(ratios)
        if ratios[pr] == np.inf:
            return {"status": "Unbounded", "method": method, "steps": steps, "standard_form": standard_form_text}

        steps.append({
            "table": tableau.tolist(),
            "basis": [headers[i] for i in basis],
            "key_row": int(pr),
            "key_col": int(pc),
            "key_element": round(float(tableau[pr, pc]), 4),
            "explanation": f"Variable {headers[pc]} enters basis at Row {pr+1}."
        })

        pivot_val = tableau[pr, pc]
        tableau[pr] /= pivot_val
        for r in range(m + 1):
            if r != pr:
                tableau[r] -= tableau[r, pc] * tableau[pr]
        basis[pr] = pc

    steps.append({
        "table": tableau.tolist(),
        "basis": [headers[i] for i in basis],
        "key_row": None, "key_col": None,
        "explanation": "Optimal Solution Found."
    })

    for i, b_var in enumerate(basis):
        if b_var in art_indices and tableau[i, -1] > 1e-6:
            return {"status": "Infeasible", "method": method, "steps": steps, "standard_form": standard_form_text}

    sol = [0.0] * n
    for i, b_var in enumerate(basis):
        if b_var < n:
            sol[b_var] = round(float(tableau[i, -1]), 4)
            
    final_z = sum(c_in[i] * sol[i] for i in range(n))

    interp = f"The optimal solution yields a {'minimum' if is_min else 'maximum'} Z value of <strong>{round(float(final_z), 4)}</strong>. "
    interp += "The values of the decision variables are: " + ", ".join([f"<strong>x{i+1} = {sol[i]}</strong>" for i in range(n)]) + ".<br><br>"
    
    return {
        "status": "Optimal",
        "method": method,
        "solution": sol,
        "z": round(float(final_z), 4),
        "steps": steps,
        "headers": headers,
        "standard_form": standard_form_text,
        "interpretation": interp,
        "plot_data": {"num_vars": n, "c": c_in, "A": A_in, "b": b_in, "signs": signs, "is_min": is_min}
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
            db.session.add(entry)
            db.session.commit()
            res['id'] = entry.id
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "Error", "message": str(e)}), 500

@app.route("/history")
def history():
    h = SimplexHistory.query.order_by(SimplexHistory.timestamp.desc()).all()
    return jsonify([{"id": x.id, "name": x.problem_name, "z": x.z_value, "method": x.method_used} for x in h])

@app.route("/history/<int:hid>")
def get_history_detail(hid):
    h = SimplexHistory.query.get_or_404(hid)
    return jsonify({
        "id": h.id, "name": h.problem_name, "method": h.method_used,
        "c": json.loads(h.c), "A": json.loads(h.A), "b": json.loads(h.b),
        "signs": json.loads(h.signs), "is_min": h.is_min, "solution": json.loads(h.solution),
        "z": h.z_value, "steps": json.loads(h.steps), "headers": json.loads(h.headers), "status": "Optimal"
    })

@app.route("/upload-image", methods=["POST"])
def upload_image():
    """
    Receives an image file from the frontend, runs Hybrid OCR (Pix2Tex / Tesseract),
    parses the output using LPPParser, and returns the structured JSON.
    """
    if 'file' not in request.files:
        return jsonify({"status": "Error", "message": "No file uploaded"}), 400
    
    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({"status": "Error", "message": "Invalid file"}), 400

    try:
        img_bytes = file.read()
        
        # 1. Run Hybrid OCR Extraction
        # This will now attempt Pix2Tex first, then Tesseract
        extracted_text, source = HybridOCR.process_image(img_bytes)
        
        # 2. Parse text to structured data
        parsed_data = LPPParser.parse(extracted_text)
        parsed_data["source"] = source
        
        print(f"OCR Success using {source}: {extracted_text[:100]}...")

        return jsonify({
            "status": "Success", 
            "data": parsed_data,
            "text": extracted_text,
            "source": source
        })

    except Exception as e:
        print(f"OCR Pipeline Error: {str(e)}")
        traceback.print_exc()
        return jsonify({"status": "Error", "message": str(e)}), 500

@app.route("/parse_lpp", methods=["POST"])
def parse_lpp():
    try:
        data = request.json
        text = data.get("text", "")
        if not text:
            return jsonify({"status": "Error", "message": "No text provided"}), 400
            
        parsed_data = LPPParser.parse(text)
        return jsonify({"status": "Success", "data": parsed_data})
    except Exception as e:
        return jsonify({"status": "Error", "message": str(e)}), 500

def build_pdf_report(h, img2d_b64=None, img3d_b64=None):
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib import colors
    import io, base64, json
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    elements = []
    styles = getSampleStyleSheet()
    
    # Title & Timestamp
    elements.append(Paragraph(f"<b>OptiSolve Report: {h.problem_name}</b>", styles['Title']))
    time_str = h.timestamp.strftime('%Y-%m-%d %H:%M:%S') if h.timestamp else "N/A"
    elements.append(Paragraph(f"<i>Date & Time of Solving: {time_str}</i>", styles['Normal']))
    elements.append(Spacer(1, 12))
    
    # Mathematical Model Re-Construction
    try:
        c_in = json.loads(h.c)
        A_in = json.loads(h.A)
        b_in = json.loads(h.b)
        signs = json.loads(h.signs)
        
        obj_type = "Minimize" if h.is_min else "Maximize"
        obj_func = f"{obj_type} Z = " + " + ".join([f"{c_v}x{i+1}" for i, c_v in enumerate(c_in)])
        
        elements.append(Paragraph("<b>Mathematical Model</b>", styles['Heading3']))
        elements.append(Paragraph(obj_func, styles['Normal']))
        elements.append(Paragraph("<b>Subject To:</b>", styles['Normal']))
        
        for i, row in enumerate(A_in):
            constraint = " + ".join([f"{val}x{j+1}" for j, val in enumerate(row)]) + f" {signs[i]} {b_in[i]}"
            elements.append(Paragraph(constraint, styles['Normal']))
            
        elements.append(Spacer(1, 12))
    except Exception as e:
        elements.append(Paragraph(f"Error loading mathematical model: {str(e)}", styles['Normal']))
        
    # Highlighting Result
    elements.append(Paragraph("<b>Optimal Solution Result (Highlighted)</b>", styles['Heading3']))
    elements.append(Paragraph(f"<b>Method Used:</b> {h.method_used}", styles['Normal']))
    elements.append(Paragraph(f"<b>Optimal Z Value: {h.z_value}</b>", styles['Normal']))
    
    sol_text = ""
    try:
        sol = json.loads(h.solution)
        sol_text = ", ".join([f"<b>x{i+1} = {val}</b>" for i, val in enumerate(sol)])
        elements.append(Paragraph(f"<b>Decision Variables:</b> {sol_text}", styles['Normal']))
    except Exception:
        pass
    elements.append(Spacer(1, 12))
    
    # Iterations
    try:
        steps = json.loads(h.steps)
        headers = ["Basis"] + json.loads(h.headers)
        
        for i, step in enumerate(steps):
            explanation = step.get('explanation', '')
            elements.append(Paragraph(f"<b>Iteration {i}:</b> {explanation}", styles['Heading3']))
            
            table_data = [headers]
            table_rows = step.get('table', [])
            basis_col = step.get('basis', [])
            
            for r_idx, row in enumerate(table_rows):
                b_var = basis_col[r_idx] if r_idx < len(basis_col) else "Z"
                formatted_row = [str(b_var)] + [f"{float(val):.2f}" for val in row]
                table_data.append(formatted_row)
                
            if len(table_data) > 1:
                t = Table(table_data)
                t.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,0), colors.grey),
                    ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
                    ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                    ('BOTTOMPADDING', (0,0), (-1,0), 6),
                    ('BACKGROUND', (0,1), (-1,-1), colors.beige),
                    ('GRID', (0,0), (-1,-1), 1, colors.black),
                ]))
                elements.append(t)
            elements.append(Spacer(1, 12))
    except Exception as e:
        elements.append(Paragraph(f"Error generating tables: {str(e)}", styles['Normal']))

    # Process Images
    if img2d_b64:
        elements.append(Paragraph("<b>2D Graphical Method Visualization</b>", styles['Heading2']))
        try:
            if img2d_b64.startswith("data:image"):
                img2d_b64 = img2d_b64.split(",")[1]
            img2d_bytes = base64.b64decode(img2d_b64)
            img = Image(io.BytesIO(img2d_bytes), width=450, height=337)
            elements.append(img)
            elements.append(Spacer(1, 12))
        except Exception as e:
            elements.append(Paragraph(f"Error rendering 2D graph: {str(e)}", styles['Normal']))
            
    if img3d_b64:
        elements.append(Paragraph("<b>3D Visualization</b>", styles['Heading2']))
        try:
            if img3d_b64.startswith("data:image"):
                img3d_b64 = img3d_b64.split(",")[1]
            img3d_bytes = base64.b64decode(img3d_b64)
            img = Image(io.BytesIO(img3d_bytes), width=450, height=337)
            elements.append(img)
            elements.append(Spacer(1, 12))
        except Exception as e:
            elements.append(Paragraph(f"Error rendering 3D graph: {str(e)}", styles['Normal']))
            
    # Final Interpretation Page
    elements.append(PageBreak())
    elements.append(Paragraph("<b>Interpretation & Graphical Analysis</b>", styles['Title']))
    elements.append(Spacer(1, 12))
    
    interp_text = (
        f"The algorithm successfully solved the linear programming problem via the {h.method_used} method. "
        f"The optimal objective achieved is <b>Z = {h.z_value}</b>, structured around the optimal "
        f"decision variable allocation: {sol_text}."
    )
    elements.append(Paragraph(interp_text, styles['Normal']))
    elements.append(Spacer(1, 12))
    
    elements.append(Paragraph("<b>Explanation of Generating Graphs:</b>", styles['Heading3']))
    graph_explanation = (
        "<b>2D Visualizations:</b> If the mathematical layout involves two primary variables, the Cartesian graph models the objective function alongside "
        "inequality boundaries. The resulting shaded geometric area defines the <b>feasible region</b>—the valid multidimensional "
        "space where all mathematical constraints mathematically intersect. The definitive corner (vertex) represents the optimum yield.<br/><br/>"
        "<b>3D Visualizations:</b> In three variable scenarios, bounding planes define a 3D Polytope rather than a 2D polygon. "
        "The theoretical interpretation dictates the simplex mathematically navigates node-to-node across "
        "the 3D structural boundaries until it arrives at the absolute highest (or lowest) topological peak."
    )
    elements.append(Paragraph(graph_explanation, styles['Normal']))
    
    elements.append(Spacer(1, 16))
    qs_graphs_note = (
        "<b>Interactive Questions (Qs) & Graphs:</b> While static graphical snapshots are rendered above (if available), "
        "you can input your original source questions (Qs) natively into the OptiSolve Web Assistant. "
        "This allows you to dynamically parse objective functions, spin 3D structures, and zoom into 2D vertices "
        "live within the web workspace."
    )
    elements.append(Paragraph(qs_graphs_note, styles['Normal']))
    
    doc.build(elements)
    buffer.seek(0)
    return buffer

@app.route("/export-pdf/<int:hid>")
def export_pdf(hid):
    h = SimplexHistory.query.get_or_404(hid)
    pdf_buffer = build_pdf_report(h)
    return send_file(pdf_buffer, as_attachment=True, download_name=f"Standard_Report_{hid}.pdf", mimetype="application/pdf")

@app.route("/export-pdf-complex", methods=["POST"])
def export_pdf_complex():
    try:
        data = request.json
        hid = data.get("hid")
        img2d = data.get("img2d")
        img3d = data.get("img3d")
        
        if not hid:
            return jsonify({"status": "Error", "message": "Missing history ID"}), 400
            
        h = SimplexHistory.query.get_or_404(hid)
        pdf_buffer = build_pdf_report(h, img2d, img3d)
        
        return send_file(pdf_buffer, as_attachment=True, download_name=f"Complex_Report_{hid}.pdf", mimetype="application/pdf")
    except Exception as e:
        return jsonify({"status": "Error", "message": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)