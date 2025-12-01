import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { runScript } from "./utils";
import { ADDRESS, CODEHASH } from "./constants";

dotenv.config();

/**
 * Pre-deployment artifact for OP Stack and ZKsync networks where the
 * Safe Singleton Factory is pre-installed as a system contract.
 */
const PREDEPLOYMENT_ARTIFACT = {
	gasPrice: 0,
	gasLimit: 0,
	signerAddress: "0x0000000000000000000000000000000000000000",
	transaction: "0x",
	address: ADDRESS,
};

async function addPredeployment() {
	let summary: { commentOutput: string; success: boolean } = {
		commentOutput: "An unexpected error occurred",
		success: false,
	};

	try {
		await verifyAndAddPredeployment();
		const chainId = process.env.CHAIN_ID;
		summary = {
			commentOutput:
				`**✅ Success:**<br>` +
				`Pre-deployment artifact added for chain ID ${chainId}.<br>` +
				`The Safe Singleton Factory is pre-installed on this network.`,
			success: true,
		};
	} catch (error) {
		summary = {
			commentOutput:
				error instanceof PredeploymentError
					? error.comment
					: `**⛔️ Error:**<br>` +
						`Unexpected error adding pre-deployment.<br>Error Details: ${error}`,
			success: false,
		};
	} finally {
		console.log(summary);
		const summaryFile = process.env.SUMMARY_FILE;
		if (summaryFile) {
			fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
		}
		if (!summary.success) {
			process.exitCode = 1;
		}
	}
}

async function verifyAndAddPredeployment() {
	// Get chain ID from environment
	const chainIdStr = process.env.CHAIN_ID;
	if (!chainIdStr) {
		throw PredeploymentError.chainIdNotProvided();
	}

	const chainId = parseInt(chainIdStr, 10);
	if (isNaN(chainId) || chainId <= 0) {
		throw PredeploymentError.invalidChainId(chainIdStr);
	}

	// Check if artifact already exists
	const artifactDir = path.join(__dirname, "..", "artifacts", `${chainId}`);
	const artifactPath = path.join(artifactDir, "deployment.json");

	if (fs.existsSync(artifactPath)) {
		throw PredeploymentError.artifactAlreadyExists(chainId);
	}

	// Get RPC URL from environment (optional but recommended for verification)
	const rpcUrl = process.env.RPC;
	if (rpcUrl) {
		await verifyPredeployment(rpcUrl, chainId);
	} else {
		console.log(
			"Warning: No RPC URL provided. Skipping on-chain verification.",
		);
	}

	// Verify chain is in chainlist (optional)
	const skipChainlistCheck = process.env.SKIP_CHAINLIST_CHECK === "true";
	if (!skipChainlistCheck) {
		const chainlist = await fetchChainlist();
		const onChainlist = chainlist.some((item) => item.chainId === chainId);
		if (!onChainlist) {
			throw PredeploymentError.chainNotListed(chainId);
		}
		console.log(`Chain ${chainId} found in chainlist.`);
	}

	// Create the artifact directory and file
	if (!fs.existsSync(artifactDir)) {
		fs.mkdirSync(artifactDir, { recursive: true });
	}

	fs.writeFileSync(
		artifactPath,
		JSON.stringify(PREDEPLOYMENT_ARTIFACT, null, "\t") + "\n",
	);

	console.log(`Pre-deployment artifact created at: ${artifactPath}`);
}

async function verifyPredeployment(rpcUrl: string, expectedChainId: number) {
	const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

	// Verify chain ID matches
	const { chainId } = await provider.getNetwork();
	if (chainId !== expectedChainId) {
		throw PredeploymentError.chainIdMismatch(expectedChainId, chainId);
	}

	// Verify factory is deployed at the expected address
	const code = await provider.getCode(ADDRESS);
	if (ethers.utils.hexDataLength(code) === 0) {
		throw PredeploymentError.factoryNotDeployed();
	}

	// Verify bytecode matches
	const codehash = ethers.utils.keccak256(code);
	if (codehash !== CODEHASH) {
		throw PredeploymentError.factoryDifferentBytecode();
	}

	console.log(`Factory verified at ${ADDRESS} on chain ${chainId}`);
}

type Chainlist = { chainId: number }[];

async function fetchChainlist() {
	const response = await fetch("https://chainlist.org/rpcs.json");
	if (!response.ok) {
		const status = response.status;
		const body = await response.text();
		console.log({ status, body });
		throw new Error(`HTTP ${status} error retrieving chain list.`);
	}

	return (await response.json()) as Chainlist;
}

class PredeploymentError extends Error {
	public comment: string;

	private constructor(message: string, comment: string) {
		super(message);
		this.name = "PredeploymentError";
		this.comment = comment;
	}

	static chainIdNotProvided() {
		return new PredeploymentError(
			"Chain ID not provided",
			`**⛔️ Error:**<br>` +
				`Chain ID not provided. Please set the CHAIN_ID environment variable.`,
		);
	}

	static invalidChainId(value: string) {
		return new PredeploymentError(
			"Invalid chain ID",
			`**⛔️ Error:**<br>` +
				`Invalid chain ID: "${value}". Chain ID must be a positive integer.`,
		);
	}

	static artifactAlreadyExists(chainId: number) {
		return new PredeploymentError(
			"Artifact already exists",
			`**⛔️ Error:**<br>` + `Artifact already exists for chain ID ${chainId}.`,
		);
	}

	static chainNotListed(chainId: number) {
		return new PredeploymentError(
			"Chain not listed",
			`**⛔️ Error:**<br>` +
				`Chain ${chainId} is not listed in the chainlist.<br>` +
				`For more information on how to add a chain, please refer to the [chainlist documentation](https://github.com/DefiLlama/chainlist?tab=readme-ov-file#add-a-chain).<br>` +
				`Set SKIP_CHAINLIST_CHECK=true to bypass this check.`,
		);
	}

	static chainIdMismatch(expected: number, actual: number) {
		return new PredeploymentError(
			"Chain ID mismatch",
			`**⛔️ Error:**<br>` +
				`Chain ID mismatch. Expected ${expected}, but RPC returned ${actual}.`,
		);
	}

	static factoryNotDeployed() {
		return new PredeploymentError(
			"Factory not deployed",
			`**⛔️ Error:**<br>` +
				`The Safe Singleton Factory is not deployed at ${ADDRESS}.<br>` +
				`This chain may not have the factory pre-installed.`,
		);
	}

	static factoryDifferentBytecode() {
		return new PredeploymentError(
			"Factory different bytecode",
			`**⛔️ Error:**<br>` +
				`The contract at ${ADDRESS} has different bytecode than expected.<br>` +
				`This may not be the Safe Singleton Factory.`,
		);
	}
}

runScript(addPredeployment);
