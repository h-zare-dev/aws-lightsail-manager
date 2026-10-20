import {
  LightsailClient, GetInstancesCommand, GetInstanceCommand, GetRegionsCommand,
  GetBlueprintsCommand, GetBundlesCommand, CreateInstancesCommand, StartInstanceCommand,
  StopInstanceCommand, RebootInstanceCommand, DeleteInstanceCommand,
  GetInstanceSnapshotsCommand, CreateInstanceSnapshotCommand, DeleteInstanceSnapshotCommand,
  CreateInstancesFromSnapshotCommand, GetInstancePortStatesCommand,
  OpenInstancePublicPortsCommand, CloseInstancePublicPortsCommand, PutInstancePublicPortsCommand,
  GetStaticIpsCommand, AllocateStaticIpCommand, AttachStaticIpCommand,
  DetachStaticIpCommand, ReleaseStaticIpCommand, type PortInfo, type Instance
} from '@aws-sdk/client-lightsail';
import { fromIni } from '@aws-sdk/credential-providers';
import type { Account } from './config.js';

export class LightsailService {
  private clients = new Map<string, LightsailClient>();
  client(account: Account, region: string) {
    if (!account.regions.includes(region)) throw new Error('This region is not permitted for this account.');
    const key = `${account.alias}:${region}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new LightsailClient({ region, credentials: fromIni({ profile: account.profile }), maxAttempts: 2 });
      this.clients.set(key, client);
    }
    return client;
  }
  async instances(account: Account, region: string) {
    const cli = this.client(account, region);
    const results: Instance[] = [];
    let pageToken: string | undefined;
    do {
      const res = await cli.send(new GetInstancesCommand({ pageToken }));
      results.push(...(res.instances ?? []));
      pageToken = res.nextPageToken;
    } while (pageToken && results.length < 1000);
    return results;
  }
  async snapshots(account: Account, region: string) {
    const cli = this.client(account, region);
    const all: Array<{ name?: string; fromInstanceName?: string; state?: string; fromBundleId?: string }> = [];
    let pageToken: string | undefined;
    do {
      const res = await cli.send(new GetInstanceSnapshotsCommand({ pageToken }));
      all.push(...(res.instanceSnapshots ?? []));
      pageToken = res.nextPageToken;
    } while (pageToken && all.length < 1000);
    return all;
  }
  async staticIps(account: Account, region: string) {
    const cli = this.client(account, region);
    const all: Array<{name?: string; ipAddress?: string; attachedTo?: string}> = [];
    let pageToken: string | undefined;
    do {
      const res = await cli.send(new GetStaticIpsCommand({ pageToken }));
      all.push(...(res.staticIps ?? []));
      pageToken = res.nextPageToken;
    } while (pageToken && all.length < 1000);
    return all;
  }
  async getInstance(account: Account, region: string, instanceName: string) {
    return (await this.client(account, region).send(new GetInstanceCommand({ instanceName }))).instance;
  }
  async bundles(account: Account, region: string) {
    const r = await this.client(account, region).send(new GetBundlesCommand({}));
    return r.bundles ?? [];
  }
  async blueprints(account: Account, region: string) {
    const r = await this.client(account, region).send(new GetBlueprintsCommand({}));
    return (r.blueprints ?? []).filter(x => x.isActive !== false);
  }
  async regions(account: Account, region: string) {
    const r = await this.client(account, region).send(new GetRegionsCommand({includeAvailabilityZones:true}));
    return r.regions ?? [];
  }
  async create(account: Account, region: string, instanceName: string, availabilityZone: string, blueprintId: string, bundleId: string, userData?: string) {
    return this.client(account, region).send(new CreateInstancesCommand({
      instanceNames: [instanceName], availabilityZone, blueprintId, bundleId,
      ipAddressType: 'dualstack', ...(userData ? { userData } : {})
    }));
  }
  async restore(account: Account, region: string, instanceSnapshotName: string, instanceName: string, availabilityZone: string, bundleId: string) {
    return this.client(account, region).send(new CreateInstancesFromSnapshotCommand({
      instanceSnapshotName, instanceNames: [instanceName], availabilityZone, bundleId
    }));
  }
  async power(account: Account, region: string, name: string, kind: 'start' | 'stop' | 'reboot' | 'delete') {
    const cli = this.client(account, region);
    switch (kind) {
      case 'start': return cli.send(new StartInstanceCommand({instanceName: name}));
      case 'stop': return cli.send(new StopInstanceCommand({instanceName: name}));
      case 'reboot': return cli.send(new RebootInstanceCommand({instanceName: name}));
      case 'delete': return cli.send(new DeleteInstanceCommand({instanceName: name}));
    }
  }
  async snapshotCreate(account: Account, region: string, instanceName: string, instanceSnapshotName: string) {
    return this.client(account, region).send(new CreateInstanceSnapshotCommand({instanceName,instanceSnapshotName}));
  }
  async snapshotDelete(account: Account, region: string, instanceSnapshotName: string) {
    return this.client(account, region).send(new DeleteInstanceSnapshotCommand({instanceSnapshotName}));
  }
  async firewall(account: Account, region: string, instanceName: string) {
    return (await this.client(account, region).send(new GetInstancePortStatesCommand({instanceName}))).portStates ?? [];
  }
  async firewallChange(account: Account, region: string, instanceName: string, change: 'open'|'close', portInfo: PortInfo) {
    const cli = this.client(account, region);
    if (change === 'open') return cli.send(new OpenInstancePublicPortsCommand({instanceName,portInfo}));
    return cli.send(new CloseInstancePublicPortsCommand({instanceName,portInfo}));
  }
  async cloneFirewall(account: Account, region: string, source: string, target: string) {
    // Replace the complete target firewall configuration with source's current rules.
    const sourceRules = await this.firewall(account, region, source);
    const portInfos: PortInfo[] = sourceRules.filter(x => x.state === 'open' || !x.state).map(x => ({
      protocol: x.protocol, fromPort: x.fromPort, toPort: x.toPort,
      ...(x.cidrs?.length ? {cidrs:x.cidrs} : {}),
      ...(x.ipv6Cidrs?.length ? {ipv6Cidrs:x.ipv6Cidrs} : {}),
      ...(x.cidrListAliases?.length ? {cidrListAliases:x.cidrListAliases} : {})
    }));
    if (!portInfos.length) throw new Error('Source has no open rules; refusing to replace the target firewall.');
    return this.client(account, region).send(new PutInstancePublicPortsCommand({ instanceName: target, portInfos }));
  }
  async reserveIp(account: Account, region: string, staticIpName: string) {
    return this.client(account, region).send(new AllocateStaticIpCommand({staticIpName}));
  }
  async attachIp(account: Account, region: string, staticIpName: string, instanceName: string) {
    return this.client(account, region).send(new AttachStaticIpCommand({staticIpName, instanceName}));
  }
  async detachIp(account: Account, region: string, staticIpName: string) {
    return this.client(account, region).send(new DetachStaticIpCommand({staticIpName}));
  }
  async releaseIp(account: Account, region: string, staticIpName: string) {
    return this.client(account, region).send(new ReleaseStaticIpCommand({staticIpName}));
  }
}
