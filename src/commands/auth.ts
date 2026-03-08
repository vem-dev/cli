import http from "node:http";

import { ConfigService } from "@vem/core";
import chalk from "chalk";
import type { Command } from "commander";

import { buildDeviceHeaders, openBrowser, WEB_URL } from "../runtime.js";

export function registerAuthCommands(program: Command) {
	program
		.command("logout")
		.description("Clear your API Key and logout from CLI")
		.action(async () => {
			try {
				const configService = new ConfigService();
				await configService.setApiKey(null);
				console.log(chalk.green("\n✔ Logged out successfully\n"));
			} catch (error: any) {
				console.error(chalk.red("\n✖ Logout Failed:"), error.message);
			}
		});

	program
		.command("login [key]")
		.description("Authenticate CLI with your API Key")
		.action(async (key) => {
			try {
				const configService = new ConfigService();

				if (key) {
					await configService.setApiKey(key);
					console.log(chalk.green("\n✔ API Key saved successfully\n"));
					return;
				}

				// No key provided -> Browser flow
				const server = http.createServer(async (req, res) => {
					const url = new URL(req.url || "/", `http://${req.headers.host}`);

					// Enable CORS for localhost callback
					res.setHeader("Access-Control-Allow-Origin", "*");
					res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

					if (req.method === "OPTIONS") {
						res.writeHead(200);
						res.end();
						return;
					}

					if (url.pathname === "/callback") {
						const receivedKey = url.searchParams.get("key");

						if (receivedKey) {
							await configService.setApiKey(receivedKey);

							// Verify key and register device
							try {
								// Assume API is on port 3002 locally or derived from env.
								// For now, hardcoding localhost:3002 as seen elsewhere in CLI,
								// or better: use a const for API_URL if available, otherwise default.
								const API_URL =
									process.env.VEM_API_URL || "http://localhost:3002";

								const headers = await buildDeviceHeaders(configService);
								await fetch(`${API_URL}/verify`, {
									headers: {
										Authorization: `Bearer ${receivedKey}`,
										...headers,
									},
								});
								console.log(chalk.gray("   Device registered successfully."));
							} catch (_e) {
								// Ignore network errors during verification, key is still saved
								console.log(
									chalk.yellow(
										"   ⚠ Could not verify key with server immediately.",
									),
								);
							}

							res.writeHead(200, { "Content-Type": "text/html" });
							res.write(`
							<html>
								<head>
 									<title>vem Login Successful</title>
									<meta charset="UTF-8">
									<meta name="viewport" content="width=device-width, initial-scale=1.0">
									<link rel="preconnect" href="https://fonts.googleapis.com">
									<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
									<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
									<link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none"><rect x="18" y="46" width="74" height="44" rx="12" stroke="%234ade80" stroke-width="6" opacity="0.9" /><rect x="30" y="32" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.6" /><rect x="42" y="18" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.35" /></svg>'>
								</head>
								<body style="background-color: #0a0a0a; color: #ffffff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0;">
									<div style="text-align: center; background: #171717; padding: 48px; border-radius: 16px; border: 1px solid #262626; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); max-width: 400px; width: 100%;">
										
										<!-- Brand Logo -->
										<div style="margin-bottom: 24px; display: flex; justify-content: center; align-items: center; gap: 12px;">
											<svg width="48" height="48" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
												<rect x="18" y="46" width="74" height="44" rx="12" stroke="#4ade80" stroke-width="6" opacity="0.9" />
												<rect x="30" y="32" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.6" />
												<rect x="42" y="18" width="74" height="44" rx="12" stroke="rgb(0, 211, 242)" stroke-width="6" opacity="0.35" />
											</svg>
											<span style="font-family: 'Space Grotesk', sans-serif; font-size: 32px; font-weight: 700; letter-spacing: -1px; color: #fff;">vem</span>
										</div>

										<h1 style="color: #4ade80; margin: 0 0 12px 0; font-size: 20px; font-weight: 600;">Login Successful</h1>
										<p style="color: #a3a3a3; margin: 0 0 32px 0; line-height: 1.5;">Your CLI is now authenticated.</p>
										
										<div style="font-size: 13px; color: #525252; padding-top: 20px; border-top: 1px solid #262626;">
											You can close this tab and return to your terminal.
										</div>
									</div>
									<script>setTimeout(() => window.close(), 3000);</script>
								</body>
							</html>
						`);
							res.end();

							console.log(chalk.green("\n✔ Login successful! API Key saved."));

							// Give time for response to flush
							setTimeout(() => {
								server.close();
								process.exit(0);
							}, 500);
						} else {
							res.writeHead(400, { "Content-Type": "text/plain" });
							res.end("Missing key parameter.");
							console.error(
								chalk.red("\n✖ Callback received but no key found."),
							);
							server.close();
							process.exit(1);
						}
					} else {
						res.writeHead(404);
						res.end("Not Found");
					}
				});

				server.listen(0, "127.0.0.1", () => {
					const addr = server.address();
					if (addr && typeof addr !== "string") {
						const port = addr.port;
						configService
							.getOrCreateDeviceId()
							.then(({ deviceId, deviceName }) => {
								const loginUrl = `${WEB_URL}/cli/login?port=${port}&deviceId=${deviceId}&deviceName=${encodeURIComponent(deviceName)}`;

								console.log(chalk.blue(`\n🌐 Opening browser to: ${loginUrl}`));
								console.log(
									chalk.gray(`   (Listening on port ${port} for callback)`),
								);

								openBrowser(loginUrl);
							});
					}
				});
			} catch (error: any) {
				console.error(chalk.red("Failed to save key:"), error);
			}
		});

	// Search Command
}
