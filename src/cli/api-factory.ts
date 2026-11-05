import { PhotosApi, type ApiOptions } from "../core/api.ts";

export type ApiFactory = (options: ApiOptions) => PhotosApi;

const defaultFactory: ApiFactory = (options) => new PhotosApi(options);

let factory: ApiFactory = defaultFactory;

export function setApiFactory(next: ApiFactory): void {
  factory = next;
}

export function resetApiFactory(): void {
  factory = defaultFactory;
}

export function createApi(options: ApiOptions): PhotosApi {
  return factory(options);
}
