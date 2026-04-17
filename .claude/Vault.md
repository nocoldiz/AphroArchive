Act as a Senior Security Engineer and Full-Stack Node.js Developer. I need you to refactor and expand my existing Express.js backend (`server/vault-server.js`) and its corresponding vanilla HTML/JS frontend for a project called "AphroArchive". 

Currently, the vault uses AES-256-GCM and PBKDF2 for encryption-at-rest. However, there are significant security vulnerabilities in the data handling, and I need to add several advanced features. 

Please implement the following updates, providing both the backend Node.js code and the necessary frontend JavaScript/UI changes.

### Phase 1: Fix Core Security Vulnerabilities
1. **Direct Decryption Streaming (No Temp Files):** Rewrite the `decryptToTemp` logic. Completely remove the use of `os.tmpdir()`. You must decrypt the `.enc` files on-the-fly and `pipe()` the decrypted stream directly to the Express `res` object.
2. **Prevent Browser Disk Caching:** When serving decrypted files/media, inject strict HTTP headers to ensure the browser strictly holds the data in RAM and never writes it to the local disk cache. Use: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Pragma: no-cache`, and `Expires: 0`.
3. **Frontend Memory Cleanup:** Ensure the frontend uses `URL.createObjectURL()` for fetching blobs, but strictly enforces `URL.revokeObjectURL()` as soon as the media is closed or removed from the DOM.

### Phase 2: Vault Settings & Password Changing
1. **New Settings UI:** Add a "Settings" button inside the unlocked vault UI.
2. **Change Password Feature:** Allow the user to change their master password. 
   * *Architectural Note:* Because the AES-256 `vaultKey` is derived directly from the password and salt via PBKDF2, changing the password changes the key. You must write a background worker or async loop on the server that securely decrypts and re-encrypts every file in `VAULT_DIR`, updates the salt, and updates the `verifyHash`.
3.**Add delete vault button** it will delete the Whole vault after a double confirm, make sure that these files cannot ever be recovered by executing crypto.randomBytes()`  to Make the data completely irrecoverable, 
4**Add enable deletion of vault if wrong password is entered 4 times**

### Phase 3: Anti-Brute Force & Silent Auto-Destruction
1. **State Tracking:** Track failed unlock attempts in the server's memory or a local low-privilege DB file.
2. **Cooldown Mechanism:** Implement an exponential backoff/cooldown timer between failed attempts (e.g., attempt 2 locks for 5 seconds, attempt 3 locks for 30 seconds).
3. **Silent Wipe (Duress):** If the user enters the wrong password 4 times in a row, the server must initiate a silent auto-destruction. 
   * The API should return a fake "loading" or standard "incorrect password" response to the client so the attacker doesn't know it was destroyed.
   * In the background, cryptographically shred the vault. Overwrite the `vault-config` (destroying the salt/hashes) and overwrite all `.enc` files in `VAULT_DIR` with random bytes using `crypto.randomBytes()` before executing `fs.unlinkSync()`. Make the data completely irrecoverable.

### Phase 4: UI Modes Integration (Reddit & Instagram Modes)
1. **Shared Authentication State:** If the vault is already unlocked (the `vaultKey` exists in the backend memory and the timer hasn't expired), entering "Reddit mode" or "Instagram mode" from the UI should bypass the password prompt. They should piggyback on the active vault session.
2. **Reddit Mode - Vault File Support:** Update the Reddit mode logic so it can render decrypted media directly from the vault API.
3. **Reddit Mode - Tag Parsing:** Automatically build the list of simulated "users" and "subreddits" by parsing the file titles and tags stored in the vault metadata. For example, if a file is tagged with `@username` and `r/subreddit`, map these dynamically into the Reddit mode UI structure.
3. **Standard vault mode** show the folders from tags in order of number of videos, make this part scrollable horizontally

Please provide the updated `vault-server.js` backend logic, the new API endpoints required, and the frontend JavaScript required to bind this all together. Prioritize secure coding practices.