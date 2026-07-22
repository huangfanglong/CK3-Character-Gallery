import os
import sys
from pathlib import Path

# --- Configuration Variables (USER MUST EDIT THESE) ---
# 1. Set the absolute, stable path to your application's primary EXE file.
APP_PATH = r"C:\StableApps\AppFolder\v3.exe" 

# 2. Define a clean directory for the shortcut and wrapper itself.
WRAPPER_DIR = Path(r"C:\Users\%USERNAME%\Desktop\AppLauncher") 
EXECUTABLE_NAME = "StableAppV3Launcher.exe" # The name of the final executable/shortcut target

def create_launcher():
    """
    Analyzes environment and generates a robust execution wrapper.
    This function assumes we are generating a simple batch file or script that points to the EXE, 
    but provides Python logic for theoretical system interaction.
    """
    print("--- EMP Agent Diagnostic Tool ---")
    
    # Step 1: Verify critical paths exist before attempting launch
    if not Path(APP_PATH).exists():
        print(f"[ERROR] Cannot locate primary application executable at: {APP_PATH}")
        print("Please verify the APP_PATH variable is set to the correct, absolute location of v3.exe.")
        return False

    # Step 2: Create a stable working directory for the shortcut launcher
    WRAPPER_DIR.mkdir(exist_ok=True)
    launcher_script_path = WRAPPER_DIR / "RunStableAppV3.bat" # Using .bat for native Windows shell linking

    print(f"[INFO] Creating stable launch wrapper at: {launcher_script_path}")
    
    # Step 3: Write the content of the batch file (This is the actual fix)
    # The contents must enforce the correct directory change and call the EXE directly.
    batch_content = f"""
@echo off
REM SET WORKING DIRECTORY TO ENSURE RELATIVE PATHS RESOLVE CORRECTLY
cd /d "{os.path.dirname(APP_PATH)}"

REM EXECUTE THE APPLICATION STABLY AND PASS ARGUMENTS IF NEEDED
"{APP_PATH}" %*

EXIT /B 0
"""

    try:
        with open(launcher_script_path, "w", encoding="utf-8") as f:
            f.write(batch_content)
        
        print("\n[SUCCESS] Stable Launch Wrapper created successfully.")
        print("----------------------------------------------------")
        print("ACTION REQUIRED: Pin THIS 'RunStableAppV3.bat' file to your taskbar.")
        print("This wrapper forces the application launch from a stable path, bypassing temporary temp icon generation and resolving shortcut instability.")
        return True

    except Exception as e:
        print(f"[FATAL] Failed to write launcher script: {e}")
        return False


if __name__ == "__main__":
    create_launcher()
