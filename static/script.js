/**
 * OptiSolve | Professional Simplex Controller
 * Full Version - Synchronized with Big-M Backend
 */

let currentSolutionId = null;

// ✅ GLOBAL INPUT VALIDATION (NEW)
function validateFullInput(n, m) {
    for (let i = 0; i < n; i++) {
        let val = document.getElementById(`c${i}`)?.value;
        if (val === "" || isNaN(val)) {
            alert(`Invalid objective coefficient at x${i+1}`);
            return false;
        }
    }

    for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
            let val = document.getElementById(`a${i}${j}`)?.value;
            if (val === "" || isNaN(val)) {
                alert(`Invalid constraint coefficient at row ${i+1}, column ${j+1}`);
                return false;
            }
        }

        let rhs = document.getElementById(`b${i}`)?.value;
        if (rhs === "" || isNaN(rhs)) {
            alert(`Invalid RHS value at constraint ${i+1}`);
            return false;
        }
    }

    return true;
}

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
            <input type="number" id="b${i}" class="rhs-input" step="any" placeholder="RHS" style="width:80px; border-color:var(--accent);">
        </div>`;
        consList.insertAdjacentHTML('beforeend', rowHtml);
    }
}

// --- 3. SOLVER EXECUTION ---

async function runSolver() {
    const n = parseInt(document.getElementById("vars").value);
    const m = parseInt(document.getElementById("cons").value);
    // 🚨 NEW VALIDATION
if (n > 10 || m > 10) {
    alert("Maximum 10 variables and 10 constraints allowed.");
    return;
}
    const is_min = document.getElementById("is_min").checked;

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
    // ✅ Prevent multiple clicks (bug fix)
    if (solveBtn.disabled) return;
    solveBtn.disabled = true;
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
    }finally {
    solveBtn.innerText = originalText;
    solveBtn.disabled = false; // re-enable button
}
}

// --- 4. UI RENDERING ---

function renderOutput(data) {
    const outputSection = document.getElementById("output");
    const varsCard = document.getElementById("variables-card");
    const varsContent = document.getElementById("variables-content");
    const stepArea = document.getElementById("step-by-step");
    const zDisplay = document.getElementById("z-value-display");
    const interpContent = document.getElementById("interpretation-content");
    const graphSection = document.getElementById("graph-section");
    const finalResultCard = document.getElementById("final-result-card");

    outputSection.classList.remove("hidden");
    outputSection.scrollIntoView({ behavior: 'smooth' });

    // 1. Variable Values
    if (data.solution) {
        varsCard.classList.remove("hidden");
        varsContent.innerHTML = data.solution.map((v, i) => `
            <div class="sol-pill">
                x<sub>${i + 1}</sub> = <span style="color:var(--accent); font-weight:900;">${v.toFixed(2)}</span>
            </div>
        `).join('');
    }

    // 2. Iteration Tables (populated later in the loop)
    
    // 3. Graphs
    if (data.plot_data) {
        graphSection.classList.remove("hidden");
        // Store data globally for iteration sync
        window.currentLPData = data;
        plotLP(data.plot_data, data.solution);
    } else {
        graphSection.classList.add("hidden");
    }

    // 4. Final Z Result & Interpretation
    if (data.status === "Optimal") {
        finalResultCard.classList.remove("hidden");
        zDisplay.innerHTML = `
            <div style="text-align:left;">
                <span style="background:var(--accent); color:white; padding:4px 12px; border-radius:4px; font-weight:800; font-size:0.65rem; letter-spacing:1px; margin-bottom:12px; display:inline-block; text-transform:uppercase;">
                    ${data.method} Method Found Optimal
                </span>
                <h2 style="font-size:3.5rem; font-weight:900; margin:5px 0; letter-spacing:-3px; color:var(--accent);">
                    Z = ${data.z.toLocaleString()}
                </h2>
            </div>
        `;
        interpContent.innerHTML = data.interpretation || "No interpretation generated.";
    } else {
        finalResultCard.classList.remove("hidden");
        zDisplay.innerHTML = `
            <div style="text-align:center; padding: 20px;">
                <h2 style="color:#f43f5e; font-weight:900;">⚠️ ${data.status.toUpperCase()}</h2>
                <p style="color:#64748b;">The algorithm could not find an optimal solution.</p>
            </div>`;
        stepArea.innerHTML = "";
        return;
    }

    // Iteration steps population
    stepArea.innerHTML = data.steps.map((s, idx) => {
        const headers = data.headers || [];
        const headerHtml = headers.map(h => `<th style="padding:12px; background:#f1f5f9; color:#475569; font-size:0.7rem; border:1px solid #e2e8f0;">${h}</th>`).join('');
        
        return `
            <div class="iteration-block" style="margin-bottom:50px; cursor:pointer; transition: 0.3s;" onclick="highlightIteration(${idx})">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <p style="font-size:0.75rem; color:#94a3b8; font-weight:800; text-transform:uppercase; letter-spacing:1px;">Iteration ${idx} <span style="margin-left:10px; color:var(--sci-teal); font-size:0.6rem;">(Click to view in graph)</span></p>
                    <p style="font-size:0.8rem; color:#1e293b; font-weight:600; background:#f8fafc; padding:4px 12px; border-radius:20px; border:1px solid #e2e8f0;">
                        ${s.explanation}
                    </p>
                </div>
                <div style="overflow-x:auto; border-radius:8px; border:1px solid #e2e8f0;">
                    <table class="data-mono" style="width:100%; border-collapse:collapse; background:white;">
                        <thead><tr>${headerHtml}</tr></thead>
                        <tbody>
                        ${s.table.map((row, rIdx) => `
                            <tr style="${rIdx === s.key_row ? 'background:#fefce8;' : ''}">
                                ${row.map((cell, cIdx) => {
                                    let cellStyle = "padding:12px; border:1px solid #e2e8f0; font-size:0.9rem; text-align:center; color:#1e293b;";
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

async function downloadPDF() {
    if(!currentSolutionId) {
        alert("Please solve a problem first to generate a report.");
        return;
    }

    const pdfBtn = document.getElementById("pdf-btn");
    const originalText = pdfBtn.innerText;
    pdfBtn.innerText = "📸 Capturing Graphs...";
    pdfBtn.disabled = true;

    try {
        let img2d = null;
        let img3d = null;

        // 1. Capture D3.js 2D Graph (SVG to PNG)
        const svgElement = document.querySelector("#plot-2d svg");
        if (svgElement) {
            img2d = await captureSvgToImage(svgElement);
        }

        // 2. Capture Plotly 3D Graph (Plotly Built-in)
        const plotlyDiv = document.getElementById("plot-3d");
        if (plotlyDiv && plotlyDiv.classList.contains("js-plotly-plot")) {
            img3d = await Plotly.toImage(plotlyDiv, { format: 'png', width: 1000, height: 700 });
        }

        pdfBtn.innerText = "📄 Generating PDF...";

        // 3. Send to Complex Export Route
        const response = await fetch("/export-pdf-complex", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                hid: currentSolutionId,
                img2d: img2d,
                img3d: img3d
            })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `OptiSolve_Full_Report_${currentSolutionId}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            const err = await response.json();
            throw new Error(err.message || "Export failed");
        }

    } catch (error) {
        console.error("PDF Export Error:", error);
        alert("Failed to export full report with graphs. Downloading standard version instead.");
        window.location.href = `/export-pdf/${currentSolutionId}`;
    } finally {
        pdfBtn.innerText = originalText;
        pdfBtn.disabled = false;
    }
}

async function captureSvgToImage(svgElement) {
    return new Promise((resolve, reject) => {
        try {
            const serializer = new XMLSerializer();
            let source = serializer.serializeToString(svgElement);

            // Add namespaces if missing
            if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
                source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            if (!source.match(/^<svg[^>]+xmlns\:xlink="http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
                source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
            }

            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            const width = svgElement.clientWidth || 800;
            const height = svgElement.clientHeight || 600;
            
            canvas.width = width * 2; // High-res
            canvas.height = height * 2;
            context.scale(2, 2);

            const img = new Image();
            const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(svgBlob);

            img.onload = () => {
                context.fillStyle = "white"; // White background for PDF
                context.fillRect(0, 0, width, height);
                context.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL("image/png"));
            };

            img.onerror = (e) => reject(e);
            img.src = url;
        } catch (e) {
            reject(e);
        }
    });
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

async function processUploadedFile() {
    const fileInput = document.getElementById("file-upload");
    const ocrStatus = document.getElementById("ocr-status");
    const ocrMsg = document.getElementById("ocr-message");

    if (!fileInput.files.length) {
        alert("Please upload a file first.");
        return;
    }

    ocrStatus.classList.remove("hidden");
    ocrMsg.innerText = "Extracting with Hybrid OCR (Mathpix/Local)...";

    try {
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch("/upload-image", {
            method: "POST",
            body: formData
        });
        
        const result = await response.json();
        
        if (result.status === "Error") throw new Error(result.message);

        ocrMsg.innerText = `✨ Auto-filling workspace (${result.source} Engine)...`;

        // Automatically map returned JSON to the main solver grid
        autoFillLppGrid(result.data);
        
        // Populate the manual UI with the raw extracted text so user sees the parse target
        document.getElementById("question-text").value = result.text;

        setTimeout(() => {
            ocrStatus.classList.add("hidden");
            document.getElementById("workspace-section").scrollIntoView({ behavior: "smooth" });
        }, 1000);

    } catch (error) {
        console.error("Hybrid OCR Error:", error);
        ocrStatus.classList.add("hidden");
        alert("⚠️ Scan failed: " + error.message);
    }
}

/**
 * Automatically populates the Simplex workspace grids with parsed LPP data.
 * @param {Object} data - Processed LPP JSON from backend.
 */
/**
 * Automatically populates the Simplex workspace grids with parsed LPP data.
 * @param {Object} data - Processed LPP JSON from backend or frontend parser.
 */
function autoFillLppGrid(data) {
    const varInput = document.getElementById("vars");
    const consInput = document.getElementById("cons");
    const isMinCheckbox = document.getElementById("is_min");

    const numVars = data.variables.length;
    const numCons = data.constraints.length;
    
    varInput.value = numVars;
    consInput.value = numCons;
    isMinCheckbox.checked = (data.objective.type === "min");

    // Initialize the Grid
    generate(); 

    // Fill Objective Coefficients
    const objInputs = document.querySelectorAll("#obj-row input");
    data.objective.coefficients.forEach((coeff, index) => {
        if (objInputs[index]) objInputs[index].value = coeff;
    });

    // Fill Constraints
    const consList = document.getElementById("cons-list");
    const constraintRows = consList.querySelectorAll(".math-row");

    data.constraints.forEach((constraint, rowIndex) => {
        const row = constraintRows[rowIndex];
        if (!row) return;

        // Fill Decision Variable Coefficients (all inputs except RHS)
        const rowInputs = row.querySelectorAll("input[type='number']:not(.rhs-input)");
        constraint.coefficients.forEach((coeff, colIndex) => {
            if (rowInputs[colIndex]) rowInputs[colIndex].value = coeff;
        });

        // Fill Operator
        const operatorSelect = row.querySelector("select");
        if (operatorSelect) operatorSelect.value = constraint.operator || constraint.type || "<=";

        // Fill RHS
        const rhsInput = row.querySelector(".rhs-input");
        if (rhsInput) rhsInput.value = constraint.rhs !== undefined ? constraint.rhs : (constraint.target || 0);
    });

    document.getElementById("math-ui").classList.remove("hidden");
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function parseTextQuestion() {
    const rawText = document.getElementById("question-text").value.trim();

    if (!rawText) {
        alert("Please enter a question first.");
        return;
    }

    try {
        // Normalize text: handle unicode signs, varied operators, and subscripts
        let text = rawText
            .replace(/≤|<=/g, "<=")
            .replace(/≥|>=/g, ">=")
            .replace(/−|–|—/g, "-") 
            .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (m) => m.charCodeAt(0) - 8320)
            .replace(/[ \t]+/g, " ") 
            .trim();

        // Support for single-line inputs by splitting on keywords
        let parts = text.split(/(?=subject to|s\.t\.|st:|constraints:)/i);
        let objectiveSection = parts[0];
        let constraintSection = parts.slice(1).join(" ");

        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        let objectiveLine = "";
        let constraintLines = [];
        let isMin = false;

        // STEP 1: Intelligent Decomposition
        if (parts.length > 1) {
            // Keyword splitting was successful
            objectiveLine = objectiveSection.trim();
            isMin = objectiveLine.toLowerCase().includes("min");
            // Extract constraints from the rest, split by common delimiters if newlines are missing
            constraintLines = constraintSection
                .replace(/(subject to|s\.t\.|st:|constraints:|where)/gi, "")
                .split(/[\n,;]/)
                .map(l => l.trim())
                .filter(l => l.length > 0 && (l.includes("<=") || l.includes(">=") || l.includes("=")));
        } else {
            // Traditional line-by-line parsing
            for (let line of lines) {
                const lower = line.toLowerCase();
                const compact = lower.replace(/\s+/g, "");

                if (lower.includes("max") || lower.includes("min")) {
                    objectiveLine = line;
                    isMin = lower.includes("min");
                } else if (compact.includes("<=") || compact.includes(">=") || (compact.includes("=") && !compact.includes("z="))) {
                    if (!compact.match(/[a-z0-9,]+>=0/i)) { // Skip non-negativity
                        constraintLines.push(line);
                    }
                }
            }
        }

        if (!objectiveLine && lines.length > 0) objectiveLine = lines[0];

        if (!objectiveLine) {
            showParseStatus("❌ Objective function not found.", "error");
            return;
        }

        // STEP 2: Intelligent Variable Discovery
        const combinedText = [objectiveLine, ...constraintLines].join(" ");
        const potentialVars = combinedText.match(/[a-zA-Z]+[0-9_\u2080-\u2089]*/g) || [];
        const blacklist = ["maximize", "max", "minimize", "min", "subject", "to", "st", "z", "constraints", "where"];
        
        let variables = [...new Set(
            potentialVars
                .map(v => v.toLowerCase())
                .filter(v => !blacklist.includes(v))
        )];

        variables.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/) || 0);
            const numB = parseInt(b.match(/\d+/) || 0);
            if (numA && numB) return numA - numB;
            return a.localeCompare(b);
        });

        if (variables.length === 0) {
            showParseStatus("❌ No variables detected.", "error");
            return;
        }

        // STEP 3: Map to autoFill format for consistency
        const lppData = {
            objective: {
                type: isMin ? "min" : "max",
                coefficients: extractCoefficients(objectiveLine.split("=").pop(), variables)
            },
            constraints: constraintLines.map(line => {
                let sign = line.includes("<=") ? "<=" : (line.includes(">=") ? ">=" : "=");
                let pts = line.split(sign);
                return {
                    coefficients: extractCoefficients(pts[0], variables),
                    operator: sign,
                    rhs: parseFloat(pts[1]) || 0
                };
            }),
            variables: variables
        };

        autoFillLppGrid(lppData);
        showParseStatus("✔ Parsing complete!", "success");
        document.getElementById("workspace-section").scrollIntoView({ behavior: "smooth" });

    } catch (error) {
        console.error("Critical Parse Error:", error);
        showParseStatus("❌ Parsing failed. Check format.", "error");
    }
}

/**
 * Robustly pulls numeric coefficients for a list of variables from a string.
 * Handles: 2x, -2x, +2x, x (implicit 1), -x (implicit -1), 0.5x
 */
function extractCoefficients(expression, variables) {
    // Strip spaces for unified regex matching, but handle variables with spaces (e.g. "x 1")
    // First, try to join variable parts if they are split by spaces in the source
    let cleanExpr = expression.replace(/\s+/g, " ");
    variables.forEach(v => {
        // Find pattern like "x 1" and replace with "x1"
        if (v.match(/[a-zA-Z]+\d+/)) {
            const parts = v.match(/([a-zA-Z]+)(\d+)/);
            const spaced = parts[1] + " " + parts[2];
            cleanExpr = cleanExpr.split(spaced).join(v);
        }
    });
    
    cleanExpr = cleanExpr.replace(/\s+/g, "");
    const results = Array(variables.length).fill(0);

    variables.forEach((variable, idx) => {
        const regex = new RegExp(`([+-]?\\d*\\.?\\d*)${variable}(?![a-zA-Z0-9_\\u2080-\\u2089])`, "g");
        
        let match;
        while ((match = regex.exec(cleanExpr)) !== null) {
            let coeffStr = match[1];
            
            let val = 0;
            if (coeffStr === "" || coeffStr === "+") val = 1;
            else if (coeffStr === "-") val = -1;
            else val = parseFloat(coeffStr);
            
            results[idx] += isNaN(val) ? 0 : val;
        }
    });

    return results;
}
function clearQuestionInput() {
    document.getElementById("question-text").value = "";
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
        // Standard D3 2D Plot
        plot2D(A, b, signs, c, solution, container2D);
        // Three.js 3D Perspective of Objective Surface
        plot3DZsurface(A, b, c, solution, container3D);
    } else if (num_vars === 3) {
        // High-end Three.js 3D Feasible Volume
        plot3D(A, b, signs, c, solution, container3D);
        // D3.js 2D Projection
        plot2Dprojection(A, b, solution, container2D);
    } else {
        const errorMsg = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#64748b; font-size:0.8rem; text-align:center; padding: 20px;">Visualization capped at 3 variables.</div>`;
        document.getElementById(container2D).innerHTML = errorMsg;
        document.getElementById(container3D).innerHTML = errorMsg;
    }
}

function plot2D(A, b, signs, c, solution, containerId) {
    const container = d3.select(`#${containerId}`);
    container.selectAll("*").remove();

    const width = container.node().clientWidth;
    const height = container.node().clientHeight || 450;
    const margin = { top: 40, right: 40, bottom: 60, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // 1. CALCULATE SCALES
    let maxVal = Math.max(...b, ...solution, 5) * 1.2;
    const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain([0, maxVal]).range([innerHeight, 0]);

    // 2. GRID LINES
    svg.append("g")
        .attr("class", "grid")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale).ticks(10).tickSize(-innerHeight).tickFormat(""))
        .style("stroke-opacity", 0.1);

    svg.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(yScale).ticks(10).tickSize(-innerWidth).tickFormat(""))
        .style("stroke-opacity", 0.1);

    // 3. AXES
    svg.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale).ticks(5))
        .attr("color", "var(--text-dim)");

    svg.append("g")
        .call(d3.axisLeft(yScale).ticks(5))
        .attr("color", "var(--text-dim)");

    // Labels
    svg.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 45)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--text-main)")
        .style("font-size", "0.7rem")
        .text("Variable x1 (Horizontal)");

    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -45)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--text-main)")
        .style("font-size", "0.7rem")
        .text("Variable x2 (Vertical)");

    // 4. FIND FEASIBLE REGION (Intersection Points)
    const points = [];
    // Include axes
    const lines = A.map((row, i) => ({ a1: row[0], a2: row[1], b: b[i], sign: signs[i] }));
    lines.push({ a1: 1, a2: 0, b: 0, sign: ">=" }); // x1 >= 0
    lines.push({ a1: 0, a2: 1, b: 0, sign: ">=" }); // x2 >= 0

    // Intersection of all pairs
    for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
            const l1 = lines[i], l2 = lines[j];
            const det = l1.a1 * l2.a2 - l1.a2 * l2.a1;
            if (Math.abs(det) > 1e-9) {
                const px = (l1.b * l2.a2 - l2.b * l1.a2) / det;
                const py = (l1.a1 * l2.b - l2.a1 * l1.b) / det;

                // Check feasibility against ALL constraints
                let isFeasible = true;
                for (const constraint of lines) {
                    const val = constraint.a1 * px + constraint.a2 * py;
                    if (constraint.sign === "<=" && val > constraint.b + 1e-7) isFeasible = false;
                    else if (constraint.sign === ">=" && val < constraint.b - 1e-7) isFeasible = false;
                    else if (constraint.sign === "=" && Math.abs(val - constraint.b) > 1e-7) isFeasible = false;
                }
                if (isFeasible) points.push({ x: px, y: py });
            }
        }
    }

    // Sort points to form polygon (Convex Hull approach)
    if (points.length > 0) {
        const center = {
            x: d3.mean(points, d => d.x),
            y: d3.mean(points, d => d.y)
        };
        points.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));

        // 5. SHADE FEASIBLE REGION
        const polyPath = d3.line()
            .x(d => xScale(d.x))
            .y(d => yScale(d.y));

        svg.append("path")
            .datum(points)
            .attr("d", polyPath)
            .attr("fill", "var(--sci-teal)")
            .attr("fill-opacity", 0)
            .attr("stroke", "var(--sci-teal)")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "5,5")
            .transition().duration(1000).delay(500)
            .attr("fill-opacity", 0.15);
    }

    // 6. DRAW CONSTRAINT LINES
    A.forEach((row, i) => {
        const a1 = row[0], a2 = row[1], rhs = b[i];
        let xPts = [], yPts = [];

        if (Math.abs(a2) > 1e-9) {
            xPts = [0, maxVal];
            yPts = [rhs / a2, (rhs - a1 * maxVal) / a2];
        } else if (Math.abs(a1) > 1e-9) {
            xPts = [rhs / a1, rhs / a1];
            yPts = [0, maxVal];
        }

        const line = svg.append("line")
            .attr("x1", xScale(xPts[0]))
            .attr("y1", yScale(yPts[0]))
            .attr("x2", xScale(xPts[0])) // Start animation at point 1
            .attr("y2", yScale(yPts[0]))
            .attr("stroke", `hsl(${i * 137.5 % 360}, 70%, 60%)`)
            .attr("stroke-width", 2)
            .attr("stroke-opacity", 0.8);

        line.transition().duration(1500)
            .attr("x2", xScale(xPts[1]))
            .attr("y2", yScale(yPts[1]));
            
        // Interactive Tooltip on line
        line.on("mouseover", function() {
            d3.select(this).attr("stroke-width", 4).attr("stroke-opacity", 1);
        }).on("mouseout", function() {
            d3.select(this).attr("stroke-width", 2).attr("stroke-opacity", 0.8);
        });
    });

    // 7. OPTIMAL POINT
    if (solution && solution.length >= 2) {
        const optimal = svg.append("g")
            .attr("class", "optimal-node")
            .attr("transform", `translate(${xScale(solution[0])},${yScale(solution[1])})`);

        optimal.append("circle")
            .attr("r", 0)
            .attr("fill", "var(--sci-crimson)")
            .style("filter", "drop-shadow(0 0 10px var(--sci-crimson))")
            .transition().duration(800).delay(1500)
            .attr("r", 8);

        optimal.append("text")
            .attr("y", -15)
            .attr("text-anchor", "middle")
            .attr("fill", "var(--sci-crimson)")
            .style("font-weight", "900")
            .style("font-size", "0.75rem")
            .style("opacity", 0)
            .text("Optimal Solution")
            .transition().duration(500).delay(2000)
            .style("opacity", 1);
            
        // Pulse effect
        function pulse() {
            optimal.select("circle")
                .transition().duration(2000)
                .attr("r", 12)
                .transition().duration(2000)
                .attr("r", 8)
                .on("end", pulse);
        }
        pulse();
    }
}

// --- INTERACTIVE ITERATION SYNC ---

function highlightIteration(index) {
    const data = window.currentLPData;
    if (!data || !data.steps || !data.steps[index]) return;

    // 1. Highlight the block in UI
    const blocks = document.querySelectorAll(".iteration-block");
    blocks.forEach((b, i) => {
        if (i === index) b.classList.add("iteration-active");
        else b.classList.remove("iteration-active");
    });

    // 2. Extract solution for this iteration
    const step = data.steps[index];
    const n = data.plot_data.num_vars;
    const headers = data.headers || [];
    const sol = new Array(n).fill(0);
    
    // Find basic variables in the current basis
    step.basis.forEach((varName, rowIdx) => {
        const varIdx = headers.indexOf(varName);
        if (varIdx >= 0 && varIdx < n) {
            sol[varIdx] = step.table[rowIdx][step.table[rowIdx].length - 1];
        }
    });

    // 3. Update Plots
    plotLP(data.plot_data, sol);
    
    // Smooth scroll back to graphs for better UX
    document.getElementById("graph-section").scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- PLOTLY 3D ENGINES (SCIENTIFIC STYLE) ---

function setupAutoRotation(containerId) {
    const gd = document.getElementById(containerId);
    if (!gd) return;

    // Clear any existing rotation interval
    if (window._plotly3DInterval) {
        clearInterval(window._plotly3DInterval);
        window._plotly3DInterval = null;
    }

    // Read initial camera eye position from layout
    let eye = { x: 1.6, y: 1.6, z: 1.2 };
    try {
        const cam = gd._fullLayout.scene.camera.eye;
        eye = { x: cam.x, y: cam.y, z: cam.z };
    } catch (e) {}

    let angle = Math.atan2(eye.y, eye.x);
    const radius = Math.sqrt(eye.x * eye.x + eye.y * eye.y);
    let z = eye.z;
    let isUserInteracting = false;
    let resumeTimeout;

    // Detect user drag/zoom and pause auto-rotation
    gd.addEventListener('mousedown', () => {
        isUserInteracting = true;
        clearTimeout(resumeTimeout);
    });
    gd.addEventListener('mouseup', () => {
        clearTimeout(resumeTimeout);
        resumeTimeout = setTimeout(() => {
            // Sync angle to where user left the camera
            try {
                const cam = gd._fullLayout.scene.camera.eye;
                angle = Math.atan2(cam.y, cam.x);
                z = cam.z;
            } catch (e) {}
            isUserInteracting = false;
        }, 2500);
    });
    gd.addEventListener('wheel', () => {
        isUserInteracting = true;
        clearTimeout(resumeTimeout);
        resumeTimeout = setTimeout(() => {
            try {
                const cam = gd._fullLayout.scene.camera.eye;
                angle = Math.atan2(cam.y, cam.x);
                z = cam.z;
            } catch (e) {}
            isUserInteracting = false;
        }, 2500);
    });

    // Rotate camera on a fixed 40ms tick (~25 FPS)
    window._plotly3DInterval = setInterval(() => {
        if (isUserInteracting) return;
        angle += 0.012; // ~0.7 degrees per frame — smooth & visible
        const newX = radius * Math.cos(angle);
        const newY = radius * Math.sin(angle);
        Plotly.relayout(gd, { 'scene.camera.eye': { x: newX, y: newY, z: z } });
    }, 40);
}

function plot3DZsurface(A, b, c, solution, containerId) {
    let maxVal = Math.max(...solution, 5) * 1.5;
    const steps = 25;

    let x = [], y = [], z = [];
    for (let i = 0; i <= steps; i++) {
        let rowX = [], rowY = [], rowZ = [];
        for (let j = 0; j <= steps; j++) {
            let xi = (i / steps) * maxVal;
            let yj = (j / steps) * maxVal;
            rowX.push(xi);
            rowY.push(yj);
            rowZ.push(c[0] * xi + c[1] * yj);
        }
        x.push(rowX); y.push(rowY); z.push(rowZ);
    }

    const traces = [{
        x: x, y: y, z: z,
        type: 'surface',
        colorscale: [[0, '#0f172a'], [0.5, '#2dd4bf'], [1, '#f59e0b']],
        opacity: 0.8,
        showscale: false,
        name: 'Objective Z',
        contours: {
            z: { show: true, usecolormap: true, project: { z: true } }
        }
    }];

    traces.push({
        x: [solution[0]], y: [solution[1]], z: [c[0] * solution[0] + c[1] * solution[1]],
        type: 'scatter3d', mode: 'markers+text',
        marker: { size: 10, color: '#f43f5e', opacity: 1, line: { width: 2, color: 'white' } },
        text: ['Current State'], textposition: 'top center',
        name: 'Solution Point'
    });

    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        scene: {
            xaxis: { title: 'x1', gridcolor: 'rgba(255,255,255,0.1)', backgroundcolor: '#020617', showbackground: true },
            yaxis: { title: 'x2', gridcolor: 'rgba(255,255,255,0.1)', backgroundcolor: '#020617', showbackground: true },
            zaxis: { title: 'Z', gridcolor: 'rgba(255,255,255,0.1)', backgroundcolor: '#020617', showbackground: true },
            camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } }
        },
        margin: { t: 0, b: 0, l: 0, r: 0 },
        font: { family: 'JetBrains Mono, monospace', color: '#94a3b8', size: 10 }
    };
    Plotly.newPlot(containerId, traces, layout).then(() => {
        setupAutoRotation(containerId);
    });
}

function plot3D(A, b, signs, c, solution, containerId) {
    const traces = [];
    let maxVal = Math.max(...solution, 5) * 1.5;

    A.forEach((row, k) => {
        const [a1, a2, a3] = row;
        const rhs = b[k];
        let x = [], y = [], z = [];
        const steps = 15;
        for (let i = 0; i <= steps; i++) {
            let rx = [], ry = [], rz = [];
            for (let j = 0; j <= steps; j++) {
                let xi = (i / steps) * maxVal;
                let yj = (j / steps) * maxVal;
                rx.push(xi); ry.push(yj);
                if (Math.abs(a3) > 1e-9) rz.push((rhs - a1 * xi - a2 * yj) / a3);
                else rz.push(null);
            }
            x.push(rx); y.push(ry);
            if (Math.abs(a3) > 1e-9) z.push(rz);
        }
        if (z.length > 0) {
            traces.push({
                x, y, z, 
                type: 'surface', 
                opacity: 0.4, 
                showscale: false, 
                name: `C${k+1}`,
                colorscale: [[0, `hsl(${k * 60}, 70%, 40%)`], [1, `hsl(${k * 60}, 70%, 60%)`]]
            });
        }
    });

    traces.push({
        x: [solution[0]], y: [solution[1]], z: [solution[2]],
        type: 'scatter3d', mode: 'markers',
        marker: { size: 12, color: '#f43f5e', line: { width: 2, color: 'white' } },
        name: 'Solution Point'
    });

    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        scene: {
            xaxis: { title: 'x1', gridcolor: 'rgba(255,255,255,0.1)', backgroundcolor: '#020617', showbackground: true },
            yaxis: { title: 'x2', gridcolor: 'rgba(255,255,255,0.1)', backgroundcolor: '#020617', showbackground: true },
            zaxis: { title: 'x3', gridcolor: 'rgba(255,255,255,0.1)', backgroundcolor: '#020617', showbackground: true },
            camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } }
        },
        margin: { t: 0, b: 0, l: 0, r: 0 },
        font: { family: 'JetBrains Mono, monospace', color: '#94a3b8', size: 10 }
    };
    Plotly.newPlot(containerId, traces, layout).then(() => {
        setupAutoRotation(containerId);
    });
}

function plot2Dprojection(A, b, solution, containerId) {
    const dummySigns = Array(A.length).fill("<=");
    const dummyC = [1, 1];
    plot2D(A.map(r => [r[0], r[1]]), b, dummySigns, dummyC, [solution[0], solution[1]], containerId);
}
