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
	let summary: { message: string; success: boolean } = {
		message: "An unexpected error occurred",
		success: false,
	};

	try {
		await verifyAndAddPredeployment();
		const chainId = process.env.CHAIN_ID;
		summary = {
			message: `Success: Pre-deployment artifact added for chain ID ${chainId}. The Safe Singleton Factory is pre-installed on this network.`,
			success: true,
		};
	} catch (error) {
		summary = {
			message:
				error instanceof Error
					? error.message
					: `Unexpected error adding pre-deployment. Error Details: ${error}`,
			success: false,
		};
	} finally {
		console.log(summary.message);
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
		throw new Error(
			"Chain ID not provided. Please set the CHAIN_ID environment variable.",
		);
	}

	const chainId = parseInt(chainIdStr, 10);
	if (isNaN(chainId) || chainId <= 0) {
		throw new Error(
			`Invalid chain ID: "${chainIdStr}". Chain ID must be a positive integer.`,
		);
	}

	// Check if artifact already exists
	const artifactDir = path.join(__dirname, "..", "artifacts", `${chainId}`);
	const artifactPath = path.join(artifactDir, "deployment.json");

	if (fs.existsSync(artifactPath)) {
		throw new Error(`Artifact already exists for chain ID ${chainId}.`);
	}

	// Verify chain is in chainlist
	const chainlist = await fetchChainlist();
	const chainData = chainlist.find((item) => item.chainId === chainId);
	if (!chainData) {
		throw new Error(
			`Chain ${chainId} is not listed in the chainlist. For more information on how to add a chain, please refer to the chainlist documentation: https://github.com/DefiLlama/chainlist?tab=readme-ov-file#add-a-chain`,
		);
	}
	console.log(`Chain ${chainId} found in chainlist.`);

	// Get RPC URL from chainlist
	const rpcUrl = getRpcFromChainData(chainData);
	if (rpcUrl) {
		console.log(`Using RPC URL from chainlist: ${rpcUrl}`);
		await verifyPredeployment(rpcUrl, chainId);
	} else {
		console.log(
			`Warning: No RPC URL found in chainlist for chain ${chainId}. Skipping on-chain verification.`,
		);
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
		throw new Error(
			`Chain ID mismatch. Expected ${expectedChainId}, but RPC returned ${chainId}.`,
		);
	}

	// Verify factory is deployed at the expected address
	const code = await provider.getCode(ADDRESS);
	if (ethers.utils.hexDataLength(code) === 0) {
		throw new Error(
			`The Safe Singleton Factory is not deployed at ${ADDRESS}. This chain may not have the factory pre-installed.`,
		);
	}

	// Verify bytecode matches
	const codehash = ethers.utils.keccak256(code);
	if (codehash !== CODEHASH) {
		throw new Error(
			`The contract at ${ADDRESS} has different bytecode than expected. This may not be the Safe Singleton Factory.`,
		);
	}

	console.log(`Factory verified at ${ADDRESS} on chain ${chainId}`);
}

type ChainData = {
	chainId: number;
	rpc?: string[];
};

type Chainlist = ChainData[];

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

function getRpcFromChainData(chainData: ChainData): string | null {
	if (!chainData.rpc || chainData.rpc.length === 0) {
		return null;
	}

	// Find the first HTTP(S) RPC URL
	for (const rpc of chainData.rpc) {
		if (rpc.startsWith("http://") || rpc.startsWith("https://")) {
			return rpc;
		}
	}

	return null;
}

runScript(addPredeployment);
