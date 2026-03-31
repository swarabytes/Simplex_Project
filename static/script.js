/**
 * OptiSolve | Professional Simplex Controller
 * Full Version - Synchronized with Big-M Backend
 */

let currentSolutionId = null;

// --- 1. THEME LOGIC ---

function toggleTheme() {
    const body = document.body;
    const label = document.getElementById("theme-label");
    const isLight = body.classList.toggle("light-mode");
    
    if(label) label.innerText = isLight ? "☀️ Light" : "🌙 Dark";
    localStorage.setItem("theme", isLight ? "light" : "dark");
}

window.onload = () => {
    if (localStorage.getItem("theme") === "light") {
        document.body.classList.add("light-mode");
        const checkbox = document.getElementById("checkbox");
        const label = document.getElementById("theme-label");
        if(checkbox) checkbox.checked = true;
        if(label) label.innerText = "☀️ Light";
    }
};

// --- 2. INPUT GENERATION ---

function generate() {
    const n = parseInt(document.getElementById("vars").value);
    const m = parseInt(document.getElementById("cons").value);

    if (isNaN(n) || isNaN(m) || n < 1 || m < 1) {
        alert("Please enter a valid number of variables and constraints.");
        return;
    }

    const mathUI = document.getElementById("math-ui");
    mathUI.classList.remove("hidden");

    const objRow = document.getElementById("obj-row");
    objRow.innerHTML = `<span style="font-weight:800; color:var(--accent); margin-right:10px;">OBJ Z =</span>`;
    for (let i = 0; i < n; i++) {
        objRow.innerHTML += `
            <div class="math-group">
                <input type="number" id="c${i}" step="any" placeholder="0">
                <span class="var-label">x<sub>${i + 1}</sub></span>
                ${i < n - 1 ? '<span class="operator">+</span>' : ''}
            </div>
        `;
    }

    const consList = document.getElementById("cons-list");
    consList.innerHTML = `<p style="text-align:left; font-size:0.7rem; color:#64748b; margin-bottom:15px; text-transform:uppercase; letter-spacing:2px;">Subject To:</p>`;
    for (let i = 0; i < m; i++) {
        let rowHtml = `<div class="math-row" id="row-${i}">`;
        for (let j = 0; j < n; j++) {
            rowHtml += `
                <div class="math-group">
                    <input type="number" id="a${i}${j}" step="any" placeholder="0">
                    <span class="var-label">x<sub>${j + 1}</sub></span>
                    ${j < n - 1 ? '<span class="operator">+</span>' : ''}
                </div>
            `;
        }
        rowHtml += `
            <select id="s${i}">
                <option value="<=">≤</option>
                <option value=">=">≥</option>
                <option value="=">=</option>
            </select>
            <input type="number" id="b${i}" step="any" placeholder="RHS" style="width:80px; border-color:var(--accent);">
        </div>`;
        consList.insertAdjacentHTML('beforeend', rowHtml);
    }
}

// --- 3. SOLVER EXECUTION ---

async function runSolver() {
    const n = parseInt(document.getElementById("vars").value);
    const m = parseInt(document.getElementById("cons").value);
    const is_min = document.getElementById("is_min").checked;

    if (n < m) {
        alert("Validation Error: Number of constraints must be less than or equal to variables !!");
        return;
    }

    let c = [], A = [], b = [], signs = [];

    try {
        for (let i = 0; i < n; i++) {
            const val = parseFloat(document.getElementById(`c${i}`).value);
            c.push(isNaN(val) ? 0 : val);
        }
        for (let i = 0; i < m; i++) {
            let row = [];
            for (let j = 0; j < n; j++) {
                const val = parseFloat(document.getElementById(`a${i}${j}`).value);
                row.push(isNaN(val) ? 0 : val);
            }
            A.push(row);
            b.push(parseFloat(document.getElementById(`b${i}`).value) || 0);
            signs.push(document.getElementById(`s${i}`).value);
        }
    } catch (err) {
        alert("Please ensure all inputs are valid numbers.");
        return;
    }

    const solveBtn = document.querySelector(".btn-solve");
    const originalText = solveBtn.innerText;
    solveBtn.innerText = "Computing...";

    try {
        const response = await fetch("/solve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ c, A, b, signs, is_min })
        });

        const data = await response.json();
        
        if (data.status === "Error") {
            alert("Server Error: " + data.message);
            return;
        }

        if (data.id) {
            currentSolutionId = data.id;
            document.getElementById("pdf-btn").classList.remove("hidden");
        }
        
        renderOutput(data);
        
        if (document.getElementById("history-sidebar").classList.contains("active")) {
            fetchHistory();
        }
    } catch (error) {
        console.error("Fetch Error:", error);
        alert("Connection to server failed. Ensure the Python server is running.");
    } finally {
        solveBtn.innerText = originalText;
    }
}

// --- 4. UI RENDERING ---

function renderOutput(data) {
    const outputSection = document.getElementById("output");
    const finalCard = document.getElementById("final-card");
    const stepArea = document.getElementById("step-by-step");
    const sensSection = document.getElementById("sensitivity-section");
    const sensContent = document.getElementById("sensitivity-content");
    const sfSection = document.getElementById("standard-form-section");
    const sfContent = document.getElementById("standard-form-content");
    const interpSection = document.getElementById("interpretation-section");
    const interpContent = document.getElementById("interpretation-content");
    const graphSection = document.getElementById("graph-section");

    outputSection.classList.remove("hidden");
    outputSection.scrollIntoView({ behavior: 'smooth' });

    // Show Standard Form
    if (data.standard_form) {
        sfSection.classList.remove("hidden");
        sfContent.innerHTML = data.standard_form.replace(/\n/g, "<br>");
    }

    // Show Interpretation
    if (data.interpretation) {
        interpSection.classList.remove("hidden");
        interpContent.innerHTML = data.interpretation;
    }

    // Handle Graphs
    if (data.plot_data) {
        graphSection.classList.remove("hidden");
        plotLP(data.plot_data, data.solution);
    } else {
        graphSection.classList.add("hidden");
    }

    if (data.status !== "Optimal") {
        finalCard.innerHTML = `
            <div style="text-align:center; padding: 20px;">
                <h2 style="color:#f43f5e; font-weight:900;">⚠️ ${data.status.toUpperCase()}</h2>
                <p style="color:#64748b;">The algorithm could not find an optimal solution for this problem.</p>
            </div>`;
        stepArea.innerHTML = "";
        if (sensSection) sensSection.classList.add("hidden");
        return;
    }

    if (sensSection && data.sensitivity && data.sensitivity.length > 0) {
        sensSection.classList.remove("hidden");
        sensContent.innerHTML = `
            <table style="width:100%; border-collapse:collapse; color:var(--text-color); font-size:0.8rem;">
                <thead>
                    <tr style="border-bottom: 2px solid var(--border);">
                        <th style="text-align:left; padding:10px;">Resource</th>
                        <th style="text-align:center; padding:10px;">Shadow Price</th>
                        <th style="text-align:center; padding:10px;">Allowable Increase</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.sensitivity.map(s => `
                        <tr style="border-bottom: 1px solid var(--border);">
                            <td style="padding:10px; font-weight:700;">${s.variable}</td>
                            <td style="padding:10px; text-align:center; color:var(--accent); font-family:monospace;">${s.shadow_price.toFixed(2)}</td>
                            <td style="padding:10px; text-align:center; opacity:0.7;">${s.allowable_increase}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else if (sensSection) {
        sensSection.classList.add("hidden");
    }

    finalCard.innerHTML = `
        <div style="text-align:left;">
            <span style="background:var(--accent); color:white; padding:4px 12px; border-radius:4px; font-weight:800; font-size:0.65rem; letter-spacing:1px; margin-bottom:12px; display:inline-block; text-transform:uppercase;">
                ${data.method} Method Found Optimal
            </span>
            <h2 style="font-size:3.5rem; font-weight:900; margin:5px 0; letter-spacing:-3px; color:var(--accent);">
                Z = ${data.z.toLocaleString()}
            </h2>
            <div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:15px;">
                ${data.solution.map((v, i) => `
                    <div class="sol-pill" style="background:#fff; padding:8px 16px; border-radius:8px; font-weight:700; border:2px solid #e2e8f0; color:#334155;">
                        x<sub>${i + 1}</sub> = ${v.toFixed(2)}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    stepArea.innerHTML = data.steps.map((s, idx) => {
        const headers = data.headers || [];
        const headerHtml = headers.map(h => `<th style="padding:12px; background:#f1f5f9; color:#475569; font-size:0.7rem; border:1px solid #e2e8f0;">${h}</th>`).join('');
        
        return `
            <div class="iteration-block" style="margin-bottom:50px; animation: fadeIn 0.5s ease-out forwards;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <p style="font-size:0.75rem; color:#94a3b8; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Iteration ${idx}</p>
                    <p style="font-size:0.8rem; color:#1e293b; font-weight:600; background:#f8fafc; padding:4px 12px; border-radius:20px; border:1px solid #e2e8f0;">
                        ${s.explanation}
                    </p>
                </div>
                <div style="overflow-x:auto; border-radius:8px; border:1px solid #e2e8f0;">
                    <table style="width:100%; border-collapse:collapse; background:white;">
                        <thead><tr>${headerHtml}</tr></thead>
                        <tbody>
                        ${s.table.map((row, rIdx) => `
                            <tr style="${rIdx === s.key_row ? 'background:#fefce8;' : ''}">
                                ${row.map((cell, cIdx) => {
                                    let cellStyle = "padding:12px; border:1px solid #e2e8f0; font-family:'JetBrains Mono', monospace; font-size:0.9rem; text-align:center; color:#1e293b;";
                                    if (rIdx === s.key_row && cIdx === s.key_col) {
                                        cellStyle += "background:#fbbf24; color:white; font-weight:900; box-shadow:inset 0 0 0 2px #d97706;";
                                    } else if (cIdx === s.key_col) {
                                        cellStyle += "background:#eff6ff;";
                                    }
                                    return `<td style="${cellStyle}">${cell.toFixed(2)}</td>`;
                                }).join('')}
                            </tr>
                        `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');
}

// --- 5. SIDEBAR & HISTORY LOGIC ---

function toggleSidebar() {
    const sb = document.getElementById("history-sidebar");
    sb.classList.toggle("active"); 
    if (sb.classList.contains("active")) {
        fetchHistory();
    }
}

async function fetchHistory() {
    try {
        const res = await fetch("/history");
        const data = await res.json();
        const list = document.getElementById("history-list");
        
        if(data.length === 0) {
            list.innerHTML = `<p style="text-align:center; color:#94a3b8; margin-top:20px;">No history yet.</p>`;
            return;
        }

        list.innerHTML = data.map(h => `
            <div class="history-item" onclick="loadHistoryDetail(${h.id})" style="position:relative; cursor:pointer; padding:15px; border-bottom:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div style="font-weight:800; color:var(--text-color); font-size:0.9rem;">${h.name}</div>
                    <button class="btn-delete-log" onclick="deleteLog(event, ${h.id})">Delete</button>
                </div>
                <div style="font-size:1.1rem; font-weight:900; color:var(--accent); margin-top:5px;">Z = ${h.z.toFixed(2)}</div>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

async function deleteLog(event, id) {
    event.stopPropagation();
    if (!confirm("Delete this record permanently?")) return;

    try {
        const res = await fetch(`/history/delete/${id}`, { method: 'DELETE' });
        if (res.ok) fetchHistory();
    } catch (e) {
        console.error("Delete failed", e);
    }
}

async function loadHistoryDetail(id) {
    const res = await fetch(`/history/${id}`);
    const data = await res.json();
    
    document.getElementById("vars").value = data.c.length;
    document.getElementById("cons").value = data.A.length;
    
    generate(); 
    
    data.c.forEach((v, i) => {
        const input = document.getElementById(`c${i}`);
        if(input) input.value = v;
    });

    data.A.forEach((row, i) => {
        row.forEach((v, j) => {
            const input = document.getElementById(`a${i}${j}`);
            if(input) input.value = v;
        });
        const rhsInput = document.getElementById(`b${i}`);
        const signSelect = document.getElementById(`s${i}`);
        if(rhsInput) rhsInput.value = data.b[i];
        if(signSelect) signSelect.value = data.signs[i];
    });

    document.getElementById("is_min").checked = data.is_min;

    currentSolutionId = id;
    renderOutput(data);
    document.getElementById("pdf-btn").classList.remove("hidden");
    
    toggleSidebar();
}

// --- 6. UTILITY FUNCTIONS ---

function downloadPDF() {
    if(currentSolutionId) {
        window.location.href = `/export-pdf/${currentSolutionId}`;
    } else {
        alert("Please solve a problem first to generate a report.");
    }
}

function resetAll() {
    if(!confirm("Are you sure you want to clear everything?")) return;
    
    document.getElementById("vars").value = 2;
    document.getElementById("cons").value = 2;
    document.getElementById("math-ui").classList.add("hidden");
    document.getElementById("output").classList.add("hidden");
    document.getElementById("obj-row").innerHTML = "";
    document.getElementById("cons-list").innerHTML = "";
    document.getElementById("step-by-step").innerHTML = "";
    document.getElementById("final-card").innerHTML = "";
    document.getElementById("pdf-btn").classList.add("hidden");
    
    const sensSection = document.getElementById("sensitivity-section");
    if(sensSection) sensSection.classList.add("hidden");

    document.getElementById("is_min").checked = false;
    currentSolutionId = null;
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', function(e) {
        const targetId = this.getAttribute('href');
        const target = document.querySelector(targetId);
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});
// --- 7. SMART QUESTION INPUT LOGIC ---

// SMART QUESTION PARSER (FINAL WORKING VERSION)
// ==========================================

function parseTextQuestion() {
    const rawText = document.getElementById("question-text").value.trim();

    if (!rawText) {
        alert("Please enter a question first.");
        return;
    }

    try {
        // Normalize text
        let text = rawText
            .replace(/≤/g, "<=")
            .replace(/≥/g, ">=")
            .replace(/−/g, "-")
            .trim();

        const lines = text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.length > 0);

        let objectiveLine = "";
        let constraintLines = [];
        let isMin = false;

        // -------------------------------
        // STEP 1: Detect objective + constraints
        // -------------------------------
        for (let line of lines) {
            const lower = line.toLowerCase().trim();
            const compact = lower.replace(/\s+/g, "");

            // Objective function
            if (
                lower.startsWith("maximize") ||
                lower.startsWith("max") ||
                lower.startsWith("minimize") ||
                lower.startsWith("min")
            ) {
                objectiveLine = line;
                isMin = lower.startsWith("min");
                continue;
            }

            // Ignore helper labels
            if (
                lower === "subject to:" ||
                lower === "subject to" ||
                lower === "s.t." ||
                lower === "s.t" ||
                lower === "st" ||
                lower === "constraints:" ||
                lower === "constraints"
            ) {
                continue;
            }

            // Ignore non-negativity like x, y >= 0
            if (/^[a-z](,[a-z])*>=0$/.test(compact)) {
                continue;
            }

            // Constraint detection
            if (
                compact.includes("<=") ||
                compact.includes(">=") ||
                (compact.includes("=") && !compact.includes("z="))
            ) {
                constraintLines.push(line);
            }
        }

        if (!objectiveLine) {
            alert("Could not detect objective function.");
            return;
        }

        if (constraintLines.length === 0) {
            showParseStatus("❌ Could not detect constraints. Check your format.", "error");
            return;
        }

        // -------------------------------
        // STEP 2: Detect variables
        // -------------------------------
        const combinedText = [objectiveLine, ...constraintLines].join(" ");

        let variables = [...new Set(
            (combinedText.match(/[a-zA-Z]+/g) || [])
                .map(v => v.toLowerCase())
                .filter(v =>
                    ![
                        "maximize", "max", "minimize", "min",
                        "subject", "to", "st", "s", "t",
                        "constraints", "z"
                    ].includes(v)
                )
        )];

        variables.sort();

        if (variables.length === 0) {
            alert("Could not detect variables.");
            return;
        }

        const n = variables.length;
        const m = constraintLines.length;

        // -------------------------------
        // STEP 3: Generate grid
        // -------------------------------
        document.getElementById("vars").value = n;
        document.getElementById("cons").value = m;
        generate();

        document.getElementById("is_min").checked = isMin;

        // -------------------------------
        // STEP 4: Parse objective coefficients
        // -------------------------------
        let objExpr = objectiveLine;

        if (objectiveLine.includes("=")) {
            objExpr = objectiveLine.split("=")[1].trim();
        } else {
            objExpr = objectiveLine
                .replace(/maximize/i, "")
                .replace(/max/i, "")
                .replace(/minimize/i, "")
                .replace(/min/i, "")
                .replace(/z/i, "")
                .trim();
        }

        const objCoeffs = extractCoefficients(objExpr, variables);

        objCoeffs.forEach((val, i) => {
            const input = document.getElementById(`c${i}`);
            if (input) input.value = val;
        });

        // -------------------------------
        // STEP 5: Parse constraints
        // -------------------------------
        constraintLines.forEach((line, i) => {
            let sign = "";

            if (line.includes("<=")) sign = "<=";
            else if (line.includes(">=")) sign = ">=";
            else if (line.includes("=")) sign = "=";

            if (!sign) return;

            const parts = line.split(sign);
            if (parts.length !== 2) return;

            const lhs = parts[0].trim();
            const rhs = parseFloat(parts[1].trim());

            const coeffs = extractCoefficients(lhs, variables);

            coeffs.forEach((val, j) => {
                const input = document.getElementById(`a${i}${j}`);
                if (input) input.value = val;
            });

            const rhsInput = document.getElementById(`b${i}`);
            const signInput = document.getElementById(`s${i}`);

            if (rhsInput) rhsInput.value = isNaN(rhs) ? 0 : rhs;
            if (signInput) signInput.value = sign;
        });

        // -------------------------------
        // STEP 6: Scroll to workspace
        // -------------------------------
        document.getElementById("workspace-section").scrollIntoView({ behavior: "smooth" });

        setTimeout(() => {
            showParseStatus("✔ Question parsed successfully! Scroll down to run the solver.", "success");
        }, 300);

    } catch (error) {
        console.error("Parser Error:", error);
        alert("Failed to parse the question. Please use a standard LP format.");
    }
}

function extractCoefficients(expression, variables) {
    expression = expression.replace(/\s+/g, "");
    const coeffs = Array(variables.length).fill(0);

    variables.forEach((variable, index) => {
        const regex = new RegExp(`([+-]?\\d*\\.?\\d*)${variable}(?![a-zA-Z0-9])`, "g");
        const matches = [...expression.matchAll(regex)];

        let total = 0;

        matches.forEach(match => {
            let coeff = match[1];

            if (coeff === "" || coeff === "+") coeff = 1;
            else if (coeff === "-") coeff = -1;
            else coeff = parseFloat(coeff);

            total += coeff;
        });

        coeffs[index] = total;
    });

    return coeffs;
}
function clearQuestionInput() {
    document.getElementById("question-text").value = "";
}

function processUploadedFile() {
    const fileInput = document.getElementById("file-upload");

    if (!fileInput.files.length) {
        alert("Please upload a file first.");
        return;
    }

    alert("OCR/Image extraction module will be connected next.");
}

function clearUploadedFile() {
    const fileInput = document.getElementById("file-upload");
    const preview = document.getElementById("file-preview");

    fileInput.value = "";
    preview.innerHTML = "";
    preview.classList.add("hidden");
}

// File preview
document.getElementById("file-upload")?.addEventListener("change", function () {
    const preview = document.getElementById("file-preview");
    if (this.files.length > 0) {
        preview.classList.remove("hidden");
        preview.innerHTML = `📄 Selected File: <strong>${this.files[0].name}</strong>`;
    }
});

// Drag & Drop
const dropZone = document.getElementById("drop-zone");

if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            document.getElementById("file-upload").files = files;

            const preview = document.getElementById("file-preview");
            preview.classList.remove("hidden");
            preview.innerHTML = `📄 Selected File: <strong>${files[0].name}</strong>`;
        }
    });
}

// Auto-generate default grid on page load
window.addEventListener("DOMContentLoaded", () => {
    generate();
}); 

function showParseStatus(message, type = "success") {
    const status = document.getElementById("parse-status");

    if (!status) return;

    status.classList.remove("hidden", "success", "error");
    status.classList.add(type);

    status.innerText = message;

    // auto-hide after 4 seconds
    setTimeout(() => {
        status.classList.add("hidden");
    }, 4000);
}

/**
 * GRAPHICAL PLOTTING ENGINE
 */
function plotLP(plotData, solution) {
    const { num_vars, A, b, signs, c, is_min } = plotData;
    const container2D = 'plot-2d';
    const container3D = 'plot-3d';
    
    // Clear containers
    document.getElementById(container2D).innerHTML = "";
    document.getElementById(container3D).innerHTML = "";

    if (num_vars === 2) {
        // Standard 2D Plot
        plot2D(A, b, signs, c, solution, container2D);
        // Special 3D Visualization of the Z surface
        plot3DZsurface(A, b, c, solution, container3D);
    } else if (num_vars === 3) {
        // 3D feasible space
        plot3D(A, b, signs, c, solution, container3D);
        // 2D slice or projection
        plot2Dprojection(A, b, solution, container2D);
    } else {
        const errorMsg = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#64748b; font-size:0.8rem; text-align:center; padding: 20px;">Visualization capped at 3 variables.</div>`;
        document.getElementById(container2D).innerHTML = errorMsg;
        document.getElementById(container3D).innerHTML = errorMsg;
    }
}

function plot2D(A, b, signs, c, solution, container) {
    const traces = [];
    let maxVal = Math.max(...b, ...solution, 10);
    const xRange = [0, maxVal * 1.5];
    const yRange = [0, maxVal * 1.5];

    A.forEach((row, i) => {
        const a1 = row[0], a2 = row[1], rhs = b[i];
        let x_pts = [], y_pts = [];
        if (Math.abs(a2) > 1e-9) {
            x_pts = [0, xRange[1]];
            y_pts = [rhs / a2, (rhs - a1 * xRange[1]) / a2];
        } else if (Math.abs(a1) > 1e-9) {
            x_pts = [rhs / a1, rhs / a1];
            y_pts = [0, yRange[1]];
        }
        traces.push({ x: x_pts, y: y_pts, mode: 'lines', name: `C${i+1}`, line: { width: 3 } });
    });

    traces.push({
        x: [solution[0]], y: [solution[1]],
        mode: 'markers+text', name: 'Optimal Point',
        text: ['Optimal'], textposition: 'top right',
        marker: { size: 14, color: '#f43f5e', symbol: 'star', line: { width: 2, color: 'white' } }
    });

    const layout = {
        title: '2D Feasible Space (x1, x2)',
        xaxis: { title: 'Variable x1', gridcolor: '#f1f5f9' },
        yaxis: { title: 'Variable x2', gridcolor: '#f1f5f9' },
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { t: 40, b: 40, l: 40, r: 40 }
    };
    Plotly.newPlot(container, traces, layout);
}

function plot3DZsurface(A, b, c, solution, container) {
    let maxVal = Math.max(...solution, 5);
    const range = maxVal * 1.5;
    const steps = 20;

    let x = [], y = [], z = [];
    for (let i = 0; i <= steps; i++) {
        let rowX = [], rowY = [], rowZ = [];
        for (let j = 0; j <= steps; j++) {
            let xi = (i / steps) * range;
            let yj = (j / steps) * range;
            rowX.push(xi);
            rowY.push(yj);
            rowZ.push(c[0] * xi + c[1] * yj);
        }
        x.push(rowX); y.push(rowY); z.push(rowZ);
    }

    const traces = [{
        x: x, y: y, z: z,
        type: 'surface',
        colorscale: 'Viridis',
        opacity: 0.7,
        showscale: false,
        name: 'Objective Z'
    }];

    traces.push({
        x: [solution[0]], y: [solution[1]], z: [c[0] * solution[0] + c[1] * solution[1]],
        type: 'scatter3d', mode: 'markers',
        marker: { size: 10, color: 'red' },
        name: 'Optimal Z'
    });

    const layout = {
        title: '3D Z-Value Perspective',
        scene: { xaxis: { title: 'x1' }, yaxis: { title: 'x2' }, zaxis: { title: 'Z' } },
        margin: { t: 0, b: 0, l: 0, r: 0 }
    };
    Plotly.newPlot(container, traces, layout);
}

function plot3D(A, b, signs, c, solution, container) {
    const traces = [];
    let maxVal = Math.max(...solution, 5);
    const limit = maxVal * 1.5;

    A.forEach((row, k) => {
        const [a1, a2, a3] = row;
        const rhs = b[k];
        let x = [], y = [], z = [];
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
            let rx = [], ry = [], rz = [];
            for (let j = 0; j <= steps; j++) {
                let xi = (i / steps) * limit;
                let yj = (j / steps) * limit;
                rx.push(xi); ry.push(yj);
                if (Math.abs(a3) > 1e-9) rz.push((rhs - a1 * xi - a2 * yj) / a3);
                else rz.push(null);
            }
            x.push(rx); y.push(ry); if (Math.abs(a3) > 1e-9) z.push(rz);
        }
        if (z.length > 0) {
            traces.push({ x, y, z, type: 'surface', opacity: 0.5, showscale: false, name: `C${k+1}` });
        }
    });

    traces.push({
        x: [solution[0]], y: [solution[1]], z: [solution[2]],
        type: 'scatter3d', mode: 'markers',
        marker: { size: 10, color: '#f43f5e' }, name: 'Optimal Solution'
    });

    const layout = {
        title: '3D Feasible Space (x1, x2, x3)',
        scene: { xaxis: { title: 'x1' }, yaxis: { title: 'x2' }, zaxis: { title: 'x3' } },
        margin: { t: 0, b: 0, l: 0, r: 0 }
    };
    Plotly.newPlot(container, traces, layout);
}

function plot2Dprojection(A, b, solution, container) {
    const traces = [{
        x: [solution[0]], y: [solution[1]],
        mode: 'markers', marker: { size: 15, color: '#f43f5e' },
        name: 'Optimal (Projection)'
    }];
    const layout = { 
        title: '2D Projection (x1, x2)', 
        xaxis: { title: 'x1' }, yaxis: { title: 'x2' },
        margin: { t: 40, b: 40, l: 40, r: 40 }
    };
    Plotly.newPlot(container, traces, layout);
}