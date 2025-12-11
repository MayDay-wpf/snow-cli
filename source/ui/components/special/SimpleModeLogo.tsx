import React from 'react';
import {Box, Text} from 'ink';
import Gradient from 'ink-gradient';

type SimpleModeLogoProps = {
	terminalWidth: number;
	logoGradient: [string, string, string];
};

export default function SimpleModeLogo({
	terminalWidth,
	logoGradient,
}: SimpleModeLogoProps) {
	if (terminalWidth >= 68) {
		// Full version: SNOW CLI (width >= 70)
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Gradient colors={logoGradient}>
					<Text bold>
						{`███████╗███╗   ██╗ ██████╗ ██╗    ██╗     ██████╗██╗     ██╗
██╔════╝████╗  ██║██╔═══██╗██║    ██║    ██╔════╝██║     ██║
███████╗██╔██╗ ██║██║   ██║██║ █╗ ██║    ██║     ██║     ██║
╚════██║██║╚██╗██║██║   ██║██║███╗██║    ██║     ██║     ██║
███████║██║ ╚████║╚██████╔╝╚███╔███╔╝    ╚██████╗███████╗██║
╚══════╝╚═╝  ╚═══╝ ╚═════╝  ╚══╝╚══╝      ╚═════╝╚══════╝╚═╝`}
					</Text>
				</Gradient>
			</Box>
		);
	}

	if (terminalWidth >= 45) {
		// Medium version: SNOW only (width 45-67)
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Gradient colors={logoGradient}>
					<Text bold>
						{`███████╗███╗   ██╗ ██████╗ ██╗    ██╗
██╔════╝████╗  ██║██╔═══██╗██║    ██║
███████╗██╔██╗ ██║██║   ██║██║ █╗ ██║
╚════██║██║╚██╗██║██║   ██║██║███╗██║
███████║██║ ╚████║╚██████╔╝╚███╔███╔╝
╚══════╝╚═╝  ╚═══╝ ╚═════╝  ╚══╝╚══╝`}
					</Text>
				</Gradient>
			</Box>
		);
	}

	// Compact version: Normal text (width < 45)
	return (
		<Box marginBottom={1}>
			<Text color="white" bold>
				<Text color="cyan">❆ </Text>
				<Gradient colors={logoGradient}>SNOW CLI</Gradient>
			</Text>
		</Box>
	);
}
