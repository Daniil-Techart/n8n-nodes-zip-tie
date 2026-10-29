'use strict';

const configuredInputs = (parameters) =>
	Array.from({ length: Number(parameters.pairs) || 1 }, (_, i) => ({
		type: 'main',
		displayName: `In ${i + 1}`,
		maxConnections: 1,
	}));

const configuredOutputs = (parameters) =>
	Array.from({ length: Number(parameters.pairs) || 1 }, (_, i) => ({
		type: 'main',
		displayName: `Out ${i + 1}`,
	}));

const configuredRequiredInputs = (parameters) => {
	if (parameters.waitForAll === false) return 1;
	return Array.from({ length: Number(parameters.pairs) || 1 }, (_, i) => i);
};

class ZipTie {
	description = {
		displayName: 'Zip Tie',
		name: 'zipTie',
		group: ['transform'],
		version: [1],
		description:
			'Bundles paired inputs at one movable point and passes each input to the matching output',
		defaults: {
			name: 'Zip Tie',
			color: '#e5484d',
		},
		icon: 'file:ziptie.svg',
		inputs: `={{ (${configuredInputs})($parameter) }}`,
		outputs: `={{ (${configuredOutputs})($parameter) }}`,
		requiredInputs: `={{ (${configuredRequiredInputs})($parameter) }}`,
		properties: [
			{
				displayName: 'Tie Color',
				name: 'tieColor',
				type: 'color',
				default: '#e5484d',
				description: 'Color of the compact Zip Tie block',
			},
			{
				displayName: 'Zip Tie Group',
				name: 'zipTieGroup',
				type: 'hidden',
				default: '',
			},
			{
				displayName: 'Zip Tie Group Size',
				name: 'zipTieGroupSize',
				type: 'hidden',
				default: 1,
			},
			{
				displayName: 'Wait for All Inputs',
				name: 'waitForAll',
				type: 'boolean',
				default: false,
				description:
					'Whether to wait for every input before passing data through. When off, data passes as soon as an input is ready.',
			},
		],
	};

	async execute() {
		const pairs = Number(this.getNodeParameter('pairs', 0, 1)) || 1;
		const result = [];

		for (let i = 0; i < pairs; i++) {
			try {
				result.push(this.getInputData(i) ?? []);
			} catch {
				result.push([]);
			}
		}

		return result;
	}
}

module.exports = { ZipTie };
