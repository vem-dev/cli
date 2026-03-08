import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function detectVemUpdateInOutput(vemDir: string): Promise<string | null> {
	try {
		// Check common locations where agents might write output
		const logsDir = join(vemDir, "logs");
		const files = await readdir(logsDir).catch(() => []);

		// Sort by most recent
		const sortedFiles = files
			.filter((f) => f.endsWith(".log"))
			.sort()
			.reverse()
			.slice(0, 5); // Check last 5 log files

		for (const file of sortedFiles) {
			const content = await readFile(join(logsDir, file), "utf-8");
			if (
				content.includes("```vem_update") ||
				content.includes("vem_update:")
			) {
				return join(logsDir, file);
			}
		}

		return null;
	} catch {
		return null;
	}
}

async function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf-8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});
}

export { detectVemUpdateInOutput, readStdin };
