import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from './editor-test-runtime.mjs';
const { LayoutView } = await load('models/editor/core/LayoutView');
const { buildClientRouteGraph } = await load('services/clientRouteGraphBuilder');
const { buildRailwayTopologyFromLayout } = await load('domain/railway/topology');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/c1-yard-topology.json', import.meta.url), 'utf8'));

test('C1 yard generates all four A destinations with the required turnout plans', () => {
  const result = buildClientRouteGraph(LayoutView.fromJSON(fixture));
  const routes = result.routes.filter(route => route.fromBlock.name === 'C1');
  const expected = {
    A1: [[9, true]],
    A2: [[1, true], [8, false], [9, false]],
    A3: [[1, false], [8, false], [9, false]],
    A4: [[2, false], [3, true], [4, false], [6, false], [7, false]],
  };
  for (const [destination, states] of Object.entries(expected)) {
    assert.ok(routes.some(route => route.toBlock.name === destination &&
      JSON.stringify(route.solution.turnoutStates.map(s => [s.address, s.closed])) === JSON.stringify(states)),
      `Missing C1 -> ${destination} turnout plan`);
  }
});

test('adjacent turnout divergent ports remain connected in either live position', () => {
  const topology = buildRailwayTopologyFromLayout(fixture);
  const nine = topology.getTurnouts().find(t => t.turnoutAddress === 9);
  const eight = topology.getTurnouts().find(t => t.turnoutAddress === 8);
  for (const closed of [false, true]) {
    eight.turnoutClosed = closed;
    nine.turnoutClosed = closed;
    assert.equal(topology.getPhysicalTrackAt(nine.getConnections().div, nine.pos)?.id, eight.id);
    assert.equal(topology.getPhysicalTrackAt(eight.getConnections().div, eight.pos)?.id, nine.id);
  }
});
