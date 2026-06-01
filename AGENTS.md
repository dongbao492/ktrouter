# Agent Rules

- Never corrupt file encoding. Use Node.js with 'utf8' to edit files, not PowerShell Replace/Out-File.
- Preserve Unicode characters as-is. Do not re-encode or force-replace.