# FlowPix AI v4.1.9

Fast Google Flow bulk image generation automation.

## What this build fixes
- Restores the proven CDP/native input + click path from v4.1.5 so prompts actually submit and Flow generates images.
- Keeps the 5-second fixed queue cadence.
- Keeps the cleaned UI: no Detect Flow, Test Prompt, Open Flow, diagnostics card, or Redoun footer.
- Keeps one debugger session attached for the entire queue instead of attaching/detaching for every prompt. Chrome may show its debugger infobar once when the queue starts; it should not reappear on every prompt.
- Detaches the debugger automatically when the queue finishes or is stopped.

## Install
1. Remove the older FlowPix AI extension.
2. Extract this ZIP.
3. Open chrome://extensions.
4. Enable Developer mode.
5. Click Load unpacked and select the extracted AutoFlow-AI-v4.1.8 folder.
6. Open/reload the Google Flow project.
7. Start the queue.

## Queue behavior
Prompt 1 -> send -> wait 5 seconds -> Prompt 2 -> send -> wait 5 seconds -> ...

The queue does not wait for image-generation completion before sending the next prompt.


## v4.1.8 status indicator
The status pill now shows **Connected** when idle/paused/finished, **Automation running** between prompts, and **Generating photo** while each prompt is being submitted. The live status is protected from the connection poll so it does not flicker back to the idle state during automation.
