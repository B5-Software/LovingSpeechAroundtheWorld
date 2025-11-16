# Data Directory

Runtime data for each mode is stored here:

- `directory/` — persistent relay manifest and Tor config for the directory authority.
- `relay/` — relay-side blockchain plus tor + config files.
- `client/` — client keyring, synced chain cache, tor preferences.

Feel free to delete subfolders to reset a mode; they will be recreated automatically.
