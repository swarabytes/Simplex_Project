import re
import json

class LPPParser:
    @staticmethod
    def parse(text):
        """
        Parses raw OCR text into structured LPP JSON.
        Handles variations in objective function and constraints.
        """
        # 1. Basic cleaning
        cleaned = text.lower().strip()
        cleaned = re.sub(r'≤|<=', '<=', cleaned)
        cleaned = re.sub(r'≥|>=', '>=', cleaned)
        cleaned = re.sub(r'[−–—−]', '-', cleaned)
        
        # Split into lines
        lines = [line.strip() for line in cleaned.split('\n') if line.strip()]
        
        result = {
            "objective": {"type": "max", "coefficients": []},
            "constraints": [],
            "variables": []
        }
        
        # 2. Extract Objective Function
        objective_line = ""
        other_lines = []
        
        for line in lines:
            if any(kw in line for kw in ["max", "min", "maximize", "minimize", "obj"]):
                objective_line = line
            elif "subject to" in line or "s.t." in line or "st:" in line:
                continue # Skip header lines
            else:
                other_lines.append(line)
        
        if not objective_line and lines:
            objective_line = lines[0] # Fallback to first line
            other_lines = lines[1:]

        if "min" in objective_line:
            result["objective"]["type"] = "min"
        
        # 3. Intelligent Variable Discovery (x1, x2, x, y, etc.)
        # Fix OCR artifacts like "x 1" -> "x1"
        cleaned_for_vars = re.sub(r'([a-z])\s+(\d+)', r'\1\2', cleaned)
        
        potential_vars = re.findall(r'[a-z]+\d*', cleaned_for_vars)
        blacklist = {"max", "min", "maximize", "minimize", "obj", "z", "subject", "to", "st", "constraints"}
        
        all_vars = sorted(list(set([v for v in potential_vars if v not in blacklist])))
        
        if not all_vars:
            all_vars = ["x1", "x2"] # Minimum default

        result["variables"] = all_vars
        # Use the space-fixed version for following coefficient extraction
        cleaned = cleaned_for_vars
        
        # 4. Extract Objective Coefficients
        result["objective"]["coefficients"] = LPPParser._extract_coeffs(objective_line, all_vars)
        
        # 5. Extract Constraints
        for line in other_lines:
            # Skip non-negativity constraints like x1, x2 >= 0
            if re.search(r'>=\s*0', line) and any(v in line for v in all_vars):
                continue
            
            match = re.search(r'(<=|>=|=)', line)
            if match:
                operator = match.group(1)
                parts = line.split(operator)
                if len(parts) >= 2:
                    coeffs = LPPParser._extract_coeffs(parts[0], all_vars)
                    rhs_match = re.search(r'(-?\d+\.?\d*)', parts[1].replace(' ', ''))
                    rhs = float(rhs_match.group(1)) if rhs_match else 0.0
                    
                    result["constraints"].append({
                        "coefficients": coeffs,
                        "operator": operator,
                        "rhs": rhs
                    })
        
        return result

    @staticmethod
    def _extract_coeffs(line, variables):
        """Helper to extract coefficients for a list of variables from a string."""
        coeffs = []
        # Remove spaces for easier matching: "2 x1 + 3 x2" -> "2x1+3x2"
        compact = line.replace(' ', '')
        
        for var in variables:
            # Find the number immediately preceding the variable
            # Handles: "3x1", "+3x1", "-3x1", "x1" (1), "-x1" (-1)
            pattern = rf'([+-]?\d*\.?\d*){var}'
            match = re.search(pattern, compact)
            
            if match:
                val = match.group(1)
                if not val or val == '+':
                    coeffs.append(1.0)
                elif val == '-':
                    coeffs.append(-1.0)
                else:
                    try:
                        coeffs.append(float(val))
                    except ValueError:
                        coeffs.append(0.0)
            else:
                coeffs.append(0.0)
        return coeffs

# Simple local test if run directly
if __name__ == "__main__":
    test_text = """
    Max Z = 3x1 + 5x2
    Subject to:
    2x1 + x2 <= 10
    x1 + 3x2 <= 15
    """
    print(json.dumps(LPPParser.parse(test_text), indent=2))
