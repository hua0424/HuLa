#!/usr/bin/env python3
"""Merge graphify semantic extraction results from subagents and continue pipeline."""
import json, os, re, sys
from pathlib import Path

BASE = Path('/home/hua/projects/peer_workspace/aichat/frontend')
TASKS_DIR = Path('/tmp/claude-1000/-home-hua-projects-peer-workspace-aichat-frontend/e9313dd0-979b-4cd3-86c9-48b6e004123a/tasks')

# Agent IDs and their descriptions
agents = [
    ('ac0c49c6eca3515ab', 'doc_chunk1'),
    ('a5692c2cc2a5c2a85', 'doc_chunk2'),
    ('a413c8fce289a1a37', 'doc_chunk3'),
    ('a750567dec45504ab', 'doc_chunk4'),
    ('a86ae05ab089c0604', 'doc_chunk5'),
    ('acffac4e18f5fc642', 'preview_chunk1'),
    ('a8ff7cc0b2864d58d', 'preview_chunk2'),
    ('a029d7c4903a5ac63', 'preview_chunk3'),
    ('a6046edd3ebbf15e5', 'preview_chunk4'),
    ('a90a6454e94dd09b4', 'preview_chunk5'),
]

def extract_json(text):
    """Extract JSON object from text that may contain surrounding content."""
    # Try to find a JSON object with nodes array
    patterns = [
        r'\{"nodes"\s*:.*"input_tokens":\d+,"output_tokens":\d+\}',
        r'\{"nodes"\s*:.*"edges"\s*:.*\}',
        r'\{"nodes"\s*:.*"hyperedges"\s*:.*\}',
    ]
    for pat in patterns:
        match = re.search(pat, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except:
                pass
    # Try lenient: find { with nodes and edges
    start = text.find('{"nodes"')
    if start >= 0:
        # Find matching closing brace
        depth = 0
        for i in range(start, len(text)):
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i+1])
                except:
                    pass
    return None

all_nodes = []
all_edges = []
all_hyperedges = []
all_nodes_seen = set()

for agent_id, name in agents:
    outfile = TASKS_DIR / f'{agent_id}.output'
    if not outfile.exists():
        print(f'  {name}: file not found')
        continue

    text = outfile.read_text()
    data = extract_json(text)

    if data and 'nodes' in data:
        # Deduplicate by node id
        new_nodes = 0
        for n in data['nodes']:
            if n['id'] not in all_nodes_seen:
                all_nodes.append(n)
                all_nodes_seen.add(n['id'])
                new_nodes += 1

        all_edges.extend(data.get('edges', []))
        all_hyperedges.extend(data.get('hyperedges', []))

        print(f'  {name}: {len(data["nodes"])} nodes ({new_nodes} new), {len(data.get("edges",[]))} edges')
    else:
        print(f'  {name}: no valid JSON extracted')

# Build final merged result
merged = {
    'nodes': all_nodes,
    'edges': all_edges,
    'hyperedges': all_hyperedges,
    'input_tokens': 0,
    'output_tokens': 0,
}

outpath = BASE / 'graphify-out' / '.graphify_semantic_new.json'
outpath.write_text(json.dumps(merged, indent=2))
print(f'\nTotal: {len(all_nodes)} nodes, {len(all_edges)} edges, {len(all_hyperedges)} hyperedges')
print(f'Saved to {outpath}')
