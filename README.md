# 🎯 OptiSolve | Advanced Simplex Solver

**OptiSolve** is a premium, full-stack Linear Programming Problem (LPP) solver designed to bridge the gap between complex mathematical theory and intuitive visualization. It allows users to go from a handwritten or printed equation to a fully visualized optimal solution in seconds using local OCR.

## ✨ Core Features

*   **📸 Scan-to-Solve (Local OCR)**: Built-in integration with `Pix2Tex` for mathematical LaTeX extraction. No cloud APIs required—fully private and cost-free.
*   **📊 Dynamic 3D Visualization**: Interactive 3D graphs powered by **Three.js** to visualize the feasible region and optimal points in 3-dimensional space.
*   **📉 Precision 2D Graphs**: Detailed D3.js-based 2D plots for dual-variable problems with constraint shading.
*   **📑 Comprehensive Reporting**: Export professional PDF reports including timestamps, mathematical formulations, and step-by-step Simplex iterations.
*   **⚡ Real-time Grid**: Interactive coefficient grid for manual data entry and instant validation.

## 🛠️ Tech Stack

*   **Backend**: Python, Flask, Pix2Tex (OCR)
*   **Frontend**: Vanilla JavaScript (ES6+), Three.js, D3.js, CSS3 (Glassmorphism)
*   **Math**: NumPy, SciPy
*   **Reporting**: FPDF

## 🚀 Getting Started

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/swarabytes/Simplex_Project.git
    cd Simplex_Project
    ```

2.  **Environment Setup**:
    ```bash
    python -m venv venv
    venv\Scripts\activate
    pip install -r requirements.txt
    ```

3.  **Run Application**:
    ```bash
    python app.py
    ```

## 📜 License
This project is licensed under the MIT License.

## 🤝 Contributors
*   **OptiSolve Team** - Core Development & Maintenance
