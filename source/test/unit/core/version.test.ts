import test from 'ava';
import {getPackageVersion, getVersionHeader} from '../../../utils/core/version.js';

// ============================================================================
// Core Domain (L0 Unit): version 基础版本契约测试
// ============================================================================

test('version: getPackageVersion returns a valid semver string', t => {
	const version = getPackageVersion();
	t.is(typeof version, 'string');
	t.true(version.length > 0);
	// 满足语义化版本基本格式 (X.Y.Z)
	t.regex(version, /^\d+\.\d+\.\d+/);
});

test('version: getVersionHeader prepends "v" prefix correctly', t => {
	const header = getVersionHeader();
	t.is(typeof header, 'string');
	t.true(header.startsWith('v'));
	t.is(header, `v${getPackageVersion()}`);
});
