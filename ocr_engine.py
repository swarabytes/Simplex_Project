import cv2
import numpy as np
import pytesseract
import re
import os
import io
import traceback

# We import PIL and LatexOCR globally but initialize gracefully.
try:
    from PIL import Image
    # NOTE: pix2tex model loading on import takes heavily on memory, and is done once.
    from pix2tex.cli import LatexOCR
    latex_model = LatexOCR()
except ImportError:
    print("Pix2Tex not installed. mathematical OCR will be unavailable.")
    latex_model = None
except Exception as e:
    print(f"Pix2Tex initialization error: {e}")
    latex_model = None

class ImagePreprocessor:
    @staticmethod
    def preprocess_for_tesseract(image_bytes):
        """Standard high-contrast binary preprocessing for Tesseract."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return image_bytes
        
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        denoise = cv2.medianBlur(gray, 3)
        sharpened = cv2.filter2D(denoise, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]))
        binary = cv2.adaptiveThreshold(sharpened, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 10)
        
        success, encoded = cv2.imencode('.png', binary)
        return encoded.tobytes() if success else image_bytes

    @staticmethod
    def preprocess_for_pix2tex(image_bytes):
        """Gentle preprocessing for deep-learning math OCR (preserve edges)."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None: return image_bytes
        
        # Grayscale + Denoise + Sharpen
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (3,3), 0)
        # Sharpening kernel
        kernel = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
        sharpened = cv2.filter2D(blurred, -1, kernel)
        
        success, encoded = cv2.imencode('.png', sharpened)
        return encoded.tobytes() if success else image_bytes

class Pix2TexClient:
    @staticmethod
    def extract(image_bytes):
        """Uses Pix2Tex (LaTeX OCR) for extracting mathematical expressions."""
        if latex_model is None:
            return None
        
        try:
            # Pix2Tex expects a PIL Image
            img = Image.open(io.BytesIO(image_bytes))
            if img.mode != 'RGB':
                img = img.convert('RGB')
            # Extract LaTeX
            math_latex = latex_model(img)
            return math_latex
        except Exception as e:
            print(f"Pix2Tex Runtime Error: {e}")
            return None

class TesseractClient:
    @staticmethod
    def extract(image_bytes):
        """Fallback OCR using local Tesseract."""
        try:
            # Check if tesseract is in PATH
            import subprocess
            subprocess.run(['tesseract', '--version'], capture_output=True, check=True)
            
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            text = pytesseract.image_to_string(img, config='--psm 6')
            return text.strip()
        except Exception as e:
            print(f"Tesseract Engine unavailable or failed: {e}")
            return None

class HybridOCR:
    @staticmethod
    def process_image(image_bytes):
        """Orchestrates OpenCV, Pix2Tex, Tesseract and formatting."""
        errors = []
        
        # 1. Try Pix2Tex first (Higher Priority for equations)
        try:
            clean_pix = ImagePreprocessor.preprocess_for_pix2tex(image_bytes)
            raw_text = Pix2TexClient.extract(clean_pix)
            if raw_text and len(raw_text.strip()) > 2:
                source = "Pix2Tex"
                return HybridOCR._normalize_text(raw_text), source
        except Exception as e:
            errors.append(f"Pix2Tex Error: {str(e)}")

        # 2. Fallback to Tesseract
        try:
            clean_tess = ImagePreprocessor.preprocess_for_tesseract(image_bytes)
            raw_text = TesseractClient.extract(clean_tess)
            if raw_text and len(raw_text.strip()) > 2:
                source = "Tesseract"
                return HybridOCR._normalize_text(raw_text), source
        except Exception as e:
            errors.append(f"Tesseract Error: {str(e)}")
            
        raise ValueError(f"Both OCR engines failed. {'; '.join(errors)}")
            
    @staticmethod
    def _normalize_text(text):
        cleaned = text
        
        # Fix Pix2Tex specific LaTeX wrappers and syntax
        cleaned = re.sub(r'\\text\{([^}]+)\}', r'\1', cleaned)   # Remove \text{} bounds
        cleaned = re.sub(r'\\(?:mathrm|mathbf|mathit)\{([^}]+)\}', r'\1', cleaned)
        cleaned = re.sub(r'\s*\\\\\s*', '\n', cleaned)           # Newlines: \\
        cleaned = re.sub(r'\\max', 'Maximize ', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\\min', 'Minimize ', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\\leq', '<=', cleaned)
        cleaned = re.sub(r'\\geq', '>=', cleaned)
        cleaned = re.sub(r'x_\{?(\d+)\}?', r'x\1', cleaned)      # x_{1} or x_1 -> x1
        
        # General formatting
        cleaned = cleaned.replace('≤', '<=').replace('≥', '>=')
        cleaned = re.sub(r'>\s*=', '>=', cleaned)
        cleaned = re.sub(r'<\s*=', '<=', cleaned)
        cleaned = re.sub(r'=\s*=', '=', cleaned)
        
        # Common var typos
        cleaned = re.sub(r'x[lI|1]', lambda m: 'x1' if m.group(0)[1] in ['l', 'I', '|'] else m.group(0), cleaned, flags=re.IGNORECASE)
        
        # Spacing fixes
        cleaned = re.sub(r'([+\-=<>])', r' \1 ', cleaned)
        
        # Fix labels
        cleaned = re.sub(r'(?i)max[a-z]*', 'Maximize', cleaned)
        cleaned = re.sub(r'(?i)min[a-z]*', 'Minimize', cleaned)
        cleaned = re.sub(r'(?i)s\.?t\.?(?:ubject to)?', 'Subject to:', cleaned)
        
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()
        
    @staticmethod
    def _normalize_text(text):
        cleaned = text
        
        # Fix Pix2Tex specific LaTeX wrappers and syntax
        cleaned = re.sub(r'\\text\{([^}]+)\}', r'\1', cleaned)   # Remove \text{} bounds
        cleaned = re.sub(r'\\(?:mathrm|mathbf|mathit)\{([^}]+)\}', r'\1', cleaned)
        cleaned = re.sub(r'\s*\\\\\s*', '\n', cleaned)           # Newlines: \\
        cleaned = re.sub(r'\\max', 'Maximize ', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\\min', 'Minimize ', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\\leq', '<=', cleaned)
        cleaned = re.sub(r'\\geq', '>=', cleaned)
        cleaned = re.sub(r'x_\{?(\d+)\}?', r'x\1', cleaned)      # x_{1} or x_1 -> x1
        
        # General formatting
        cleaned = cleaned.replace('≤', '<=').replace('≥', '>=')
        cleaned = re.sub(r'>\s*=', '>=', cleaned)
        cleaned = re.sub(r'<\s*=', '<=', cleaned)
        cleaned = re.sub(r'=\s*=', '=', cleaned)
        
        # Common var typos
        cleaned = re.sub(r'x[lI|1]', lambda m: 'x1' if m.group(0)[1] in ['l', 'I', '|'] else m.group(0), cleaned, flags=re.IGNORECASE)
        
        # Spacing fixes
        cleaned = re.sub(r'([+\-=<>])', r' \1 ', cleaned)
        
        # Fix labels
        cleaned = re.sub(r'(?i)max[a-z]*', 'Maximize', cleaned)
        cleaned = re.sub(r'(?i)min[a-z]*', 'Minimize', cleaned)
        cleaned = re.sub(r'(?i)s\.?t\.?(?:ubject to)?', 'Subject to:', cleaned)
        
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()
