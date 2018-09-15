/**
 * @module "ethpm/manifest/v2"
 */

import deepEqual = require("deep-equal");
import * as t from "io-ts";
import { ThrowReporter } from "io-ts/lib/ThrowReporter";

import { URL } from "url";
import * as stringify from "json-stable-stringify";

import { lift, lift2 } from "types";
import * as schema from "ethpm-spec";
import * as config from "ethpm/config";
import * as pkg from "ethpm/package";
import * as manifest from "ethpm/manifest/service";

const VERSION = "2";

namespace Fields {
  export function readContractTypes (contractTypes: schema.ContractTypes): pkg.ContractTypes {
    return Object.assign(
      {},
      ...Object.entries(contractTypes)
        .map(
          ([ alias, contractType ]) => ({
            [alias]: readContractType(contractType, alias)
          })
        )
    );
  }

  export function readDeployments (
    deployments: schema.Deployments,
    types: pkg.ContractTypes
  ): pkg.Deployments {
    return new Map(
      Object.entries(deployments)
        .map(
          ([ chainURI, deployment ]) => ([
            new URL(chainURI),
            readDeployment(deployment, types)
          ] as [pkg.ChainURI, pkg.Deployment])
        )
    );
  }

  export function readContractType (
    contractType: schema.ContractType,
    alias: string
  ): pkg.ContractType {
    return {
      contractName: contractType.contract_name || alias,
      deploymentBytecode: lift(readUnlinkedBytecode)(contractType.deployment_bytecode),
      runtimeBytecode: lift(readUnlinkedBytecode)(contractType.runtime_bytecode),
      abi: contractType.abi,
      natspec: contractType.natspec,
      compiler: lift(readCompiler)(contractType.compiler)
    };
  }

  export function readUnlinkedBytecode(
    bytecode: schema.UnlinkedBytecodeObject
  ): pkg.UnlinkedBytecode {
    return {
      bytecode: bytecode.bytecode,
      linkReferences: [...(bytecode.link_references || [])]
    };
  }

  export function readLinkedBytecode(
    bytecode?: schema.LinkedBytecodeObject,
    parent?: pkg.UnlinkedBytecode
  ): pkg.LinkedBytecode | undefined {
    // bytecode of some kind is required
    if (!bytecode) {
      return undefined;
    }

    const bytestring = (bytecode.bytecode)
      ? bytecode.bytecode
      : parent && parent.bytecode;

    // needs bytestring itself or from parent
    if (!bytestring) {
      return undefined;
    }

    return {
      bytecode: bytestring,
      linkReferences: [...(
        (bytecode.link_references)
          ? bytecode.link_references
          : (parent && parent.linkReferences)
            ? parent.linkReferences
            : []
      )],
      linkDependencies: readLinkDependencies(bytecode.link_dependencies),
    };
  }

  export function readLinkDependencies(
    linkDependencies: schema.LinkDependencies
  ): Array<pkg.Link.Value> {
    return [
      ...(linkDependencies || [])
        .map(
          ({ offsets, value, type }) => ({
            offsets,
            value: (type === "literal")
              ? {
                value: value as string,
                type: type as "literal"
              }
              : {
                value: value as string,
                type: type as "reference"
              }
          })
        )
      ];
  }

  export function readCompiler(compiler: schema.CompilerInformation): pkg.Compiler {
    return {
      name: compiler.name,
      version: compiler.version,
      settings: compiler.settings || {},
    };
  }

  export function readDeployment (
    deployment: schema.Deployment,
    types: pkg.ContractTypes
  ): pkg.Deployment {
    return Object.assign(
      {}, ...Object.entries(deployment) .map(
        ([ name, instance ]) => ({
          [name]: readInstance(instance, types)
        })
      )
    );
  }

  export function readInstance (
    instance: schema.ContractInstance,
    types: pkg.ContractTypes
  ): pkg.ContractInstance {
    return {
      contractType: instance.contract_type,
      address: instance.address,
      transaction: instance.transaction,
      block: instance.block,
      deploymentBytecode: readLinkedBytecode(
        instance.deployment_bytecode,
        (types[instance.contract_type] || {}).deploymentBytecode
      ),
      runtimeBytecode: readLinkedBytecode(
        instance.runtime_bytecode,
        (types[instance.contract_type] || {}).runtimeBytecode
      ),
      compiler: lift(readCompiler)(instance.compiler),
    }
  }


  export function writeContractTypes (contractTypes: pkg.ContractTypes): schema.ContractTypes {
    return Object.assign(
      {},
      ...Object.entries(contractTypes)
        .map(
          ([ alias, contractType ]) => ({
            [alias]: writeContractType(contractType, alias)
          })
        )
    );
  }

  export function writeDeployments (
    deployments: pkg.Deployments,
    types: pkg.ContractTypes,
  ): schema.Deployments {
    return Object.assign({}, ...
      Array.from(deployments.entries())
        .map( ([ chainURI, deployment ]) => ({
          [chainURI.href]: writeDeployment(deployment, types)
        }))
    );
  }

  export function writeContractType (
    contractType: pkg.ContractType,
    alias: pkg.ContractAlias
  ): schema.ContractType {
    return Object.assign(
      {
        deployment_bytecode: lift(writeUnlinkedBytecode)(contractType.deploymentBytecode),
        runtime_bytecode: lift(writeUnlinkedBytecode)(contractType.runtimeBytecode),
        abi: contractType.abi,
        natspec: contractType.natspec,
        compiler: lift(writeCompiler)(contractType.compiler)
      },

      (contractType.contractName != alias)
        ? { contract_name: contractType.contractName }
        : {}
    );
  }

  export function writeUnlinkedBytecode(
    bytecode: pkg.UnlinkedBytecode
  ): schema.UnlinkedBytecodeObject {
    return {
      bytecode: bytecode.bytecode,
      link_references: [...bytecode.linkReferences]
    };
  }

  export function writeLinkedBytecode(
    bytecode: pkg.LinkedBytecode,
    parent?: pkg.UnlinkedBytecode
  ): schema.LinkedBytecodeObject {
    return Object.assign(
      {
        link_dependencies: writeLinkDependencies(bytecode.linkDependencies),
      },

      (!parent || !deepEqual(bytecode.linkReferences, parent.linkReferences))
        ? { link_references: [...bytecode.linkReferences] }
        : {},

      (!parent || bytecode.bytecode != parent.bytecode)
        ? { bytecode: bytecode.bytecode }
        : {}
    );
  }

  export function writeLinkDependencies(
    linkDependencies: Array<pkg.Link.Value>
  ): schema.LinkDependencies {
    return [
      ...(linkDependencies || [])
        .map(
          ({ offsets, value }) => Object.assign(
            { offsets },
            "type" in value ? { type: value.type } : {},
            "value" in value ? { value: value.value } : {}
          )
        )
      ];
  }

  export function writeCompiler(compiler: pkg.Compiler): schema.CompilerInformation {
    return {
      name: compiler.name,
      version: compiler.version,
      settings: compiler.settings,
    };
  }

  export function writeDeployment (
    deployment: pkg.Deployment,
    types: pkg.ContractTypes
  ): schema.Deployment {
    return Object.assign(
      {}, ...Object.entries(deployment).map(
        ([ name, instance ]) => ({
          [name]: writeInstance(instance, types)
        })
      )
    );
  }

  export function writeInstance (
    instance: pkg.ContractInstance,
    types: pkg.ContractTypes
  ): schema.ContractInstance {
    return Object.assign(
      {
        contract_type: instance.contractType,
        address: instance.address as schema.Address,
        compiler: lift(writeCompiler)(instance.compiler),
      },

      (instance.deploymentBytecode)
        ? {
            deployment_bytecode: writeLinkedBytecode(
              instance.deploymentBytecode,
              (types[instance.contractType] || {}).deploymentBytecode
            )
          }
        : {},

      (instance.runtimeBytecode)
        ? {
            runtime_bytecode: writeLinkedBytecode(
              instance.runtimeBytecode,
              (types[instance.contractType] || {}).runtimeBytecode
            )
          }
        : {},

      instance.transaction ? { transaction: instance.transaction } : {},

      instance.block ? { block: instance.block } : {},
    )
  }
}

export class Reader {
  private manifest: schema.PackageManifest;

  constructor (manifest: schema.PackageManifest) {
    this.manifest = manifest;
  }

  read (): pkg.Package {
    return {
      packageName: this.packageName,
      version: this.version,
      meta: this.meta,
      sources: this.sources,
      contractTypes: this.contractTypes,
      deployments: this.deployments,
      buildDependencies: this.buildDependencies
    };
  }

  get packageName () {
    return this.manifest.package_name;
  }

  get version () {
    return this.manifest.version;
  }

  get meta () {
    const metadata = this.manifest.meta || {};

    return {
      authors: metadata.authors,
      license: metadata.license,
      description: metadata.description as pkg.Meta.Description,
      keywords: metadata.keywords as Array<pkg.Meta.Keyword>,
      links: Object.entries(metadata.links || {}).map(
        ([ resource, uri ]) => ({ resource, uri })
      ),
    };
  }

  get sources () {
    const sources = this.manifest.sources || {};

    return Object.assign(
      {},
      ...Object.entries(sources)
        .map( ([ path, source ]) => {
          try {
            return { [path]: new URL(source) as pkg.ContentURI };
          } catch (e) {
            return { [path]: source as pkg.SourceString }
          }
        })
    );
  }

  get contractTypes () {
    return Fields.readContractTypes(this.manifest.contract_types || {});
  }

  get deployments () {
    return Fields.readDeployments(
      this.manifest.deployments || {},
      this.contractTypes
    );
  }

  get buildDependencies () {
    return Object.assign(
      {},
      ...Object.entries(this.manifest.build_dependencies || {})
        .map(
          ([ name, contentURI ]) => ({
            [name]: new URL(contentURI)
          })
        )
    );
  }
}

export class Writer {
  private package: pkg.Package;

  constructor (package_: pkg.Package) {
    this.package = package_;
  }

  get package_name () {
    return this.package.packageName;
  }

  get version () {
    return this.package.version;
  }

  get meta () {
    const metadata = this.package.meta;

    return Object.assign(
      (metadata.authors && metadata.authors.length > 0)
        ? { authors: metadata.authors }
        : {},

      (metadata.license)
        ? { license: metadata.license }
        : {},

      (metadata.description)
        ? { description: metadata.description }
        : {},

      (metadata.keywords && metadata.keywords.length > 0)
        ? { keywords: metadata.keywords }
        : {},

      (metadata.links && metadata.links.length > 0)
        ? {
            links: Object.assign({}, ...metadata.links.map(
              ({ resource, uri }) => ({ [resource]: uri })
            ))
          }
        : {}
    );
  }

  get sources () {
    const sources = this.package.sources;

    return Object.assign(
      {},
      ...Object.entries(sources)
        .map(
          ([ path, source ]) => (source instanceof URL)
             ? { [path]: source.href }
             : { [path]: source }
        )
    );
  }

  get contract_types () {
    return Fields.writeContractTypes(this.package.contractTypes);
  }

  get deployments () {
    return Fields.writeDeployments(this.package.deployments, this.package.contractTypes);
  }

  get build_dependencies () {
    return Object.assign(
      {},
      ...Object.entries(this.package.buildDependencies)
        .map(
          ([ name, contentURI ]) => ({
            [name]: contentURI.href
          })
        )
    );
  }

  write (): schema.PackageManifest {
    return Object.assign(
      {
        manifest_version: VERSION,
        package_name: this.package_name,
        version: this.version,
      },

      (Object.keys(this.deployments).length > 0)
        ? { deployments: this.deployments }
        : {},

      (Object.keys(this.contract_types).length > 0)
        ? { contract_types: this.contract_types }
        : {},

      (Object.keys(this.sources).length > 0)
        ? { sources: this.sources }
        : {},

      (Object.keys(this.build_dependencies).length > 0)
        ? { build_dependencies: this.build_dependencies }
        : {},

      (Object.keys(this.meta).length > 0)
        ? { meta: this.meta }
        : {}
    ) as schema.PackageManifest;
  }
}

const v2 = {
  version: VERSION,

  readSync: (json: string) =>
    new Reader(JSON.parse(json) as schema.PackageManifest).read(),

  read: async (json: string) =>
    new Reader(JSON.parse(json) as schema.PackageManifest).read(),

  write: async (pkg: pkg.Package) =>
    stringify(await new Writer(pkg).write())
}

export { v2 };

export default class Connector extends config.Connector<manifest.Service> {
  optionsType = t.interface({});

  async init (): Promise<manifest.Service> {
    return v2;
  }
}
