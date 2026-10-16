import test from 'ava';
import {isLocalOrPrivateHost} from '../../../utils/core/proxyUtils.js';

// ============================================================================
// Core Domain (L0 Unit): proxyUtils 纯逻辑验证
// 依据 testing-scenario-cli 与 testing-core-oracle 契约判定
// ============================================================================

test('proxyUtils: isLocalOrPrivateHost identifies localhost and loopback domains', t => {
	t.true(isLocalOrPrivateHost('localhost'));
	t.true(isLocalOrPrivateHost('LOCALHOST'));
	t.true(isLocalOrPrivateHost('sub.localhost'));
	t.true(isLocalOrPrivateHost('service.local'));
	t.true(isLocalOrPrivateHost('  localhost  '));
});

test('proxyUtils: isLocalOrPrivateHost identifies IPv4 loopback and private networks', t => {
	// 127.0.0.0/8 Loopback
	t.true(isLocalOrPrivateHost('127.0.0.1'));
	t.true(isLocalOrPrivateHost('127.0.1.1'));

	// 10.0.0.0/8 Private
	t.true(isLocalOrPrivateHost('10.0.0.1'));
	t.true(isLocalOrPrivateHost('10.255.255.254'));

	// 172.16.0.0/12 Private
	t.true(isLocalOrPrivateHost('172.16.0.1'));
	t.true(isLocalOrPrivateHost('172.31.255.254'));
	t.false(isLocalOrPrivateHost('172.15.0.1'));
	t.false(isLocalOrPrivateHost('172.32.0.1'));

	// 192.168.0.0/16 Private
	t.true(isLocalOrPrivateHost('192.168.1.1'));
	t.true(isLocalOrPrivateHost('192.168.254.254'));

	// 169.254.0.0/16 Link-local
	t.true(isLocalOrPrivateHost('169.254.1.1'));

	// 100.64.0.0/10 Carrier-grade NAT
	t.true(isLocalOrPrivateHost('100.64.0.1'));
	t.true(isLocalOrPrivateHost('100.127.255.254'));
	t.false(isLocalOrPrivateHost('100.63.255.254'));
	t.false(isLocalOrPrivateHost('100.128.0.1'));
});

test('proxyUtils: isLocalOrPrivateHost identifies IPv6 loopback and IPv4-mapped addresses', t => {
	t.true(isLocalOrPrivateHost('::1'));
	t.true(isLocalOrPrivateHost('[::1]'));
	t.true(isLocalOrPrivateHost('::'));
	t.true(isLocalOrPrivateHost('::ffff:127.0.0.1'));
	t.true(isLocalOrPrivateHost('::ffff:192.168.1.1'));
	t.false(isLocalOrPrivateHost('::ffff:8.8.8.8'));
});

test('proxyUtils: isLocalOrPrivateHost returns false for public WAN addresses', t => {
	t.false(isLocalOrPrivateHost('8.8.8.8'));
	t.false(isLocalOrPrivateHost('1.1.1.1'));
	t.false(isLocalOrPrivateHost('api.openai.com'));
	t.false(isLocalOrPrivateHost('github.com'));
	t.false(isLocalOrPrivateHost('140.82.121.4'));
});
