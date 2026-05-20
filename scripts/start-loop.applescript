-- Mapsly autonomous build loop · fully-automated launcher (AppleScript)
--
-- Opens Terminal at the project directory, runs `claude`, waits for
-- the session to boot, and types "/loop 5m" + Enter so the loop is
-- armed without any manual typing.
--
-- ONE-TIME SETUP · System Settings → Privacy & Security → Accessibility
--   Grant access to Terminal.app (you'll be prompted automatically the
--   first time this script runs).
--
-- Run via:  osascript scripts/start-loop.applescript
-- Or double-click after saving as a .scpt (via Script Editor → Export).

tell application "Terminal"
	activate
	do script "cd ~/Documents/Claude/Projects/mapsly && exec claude"
end tell

-- Wait for Claude Code to finish booting. 6 seconds is generous for
-- most machines; bump if your Mac is slow.
delay 6

-- Send the slash command + Enter to whichever Terminal window is frontmost
-- (the one we just opened above).
tell application "System Events"
	tell process "Terminal"
		keystroke "/loop 5m"
		key code 36 -- Return
	end tell
end tell

-- Show a notification so you know the script reached the end.
display notification "Loop armed · 5-min cadence · 7-day expiry. Leave this Terminal window open." with title "Mapsly autonomous loop"
