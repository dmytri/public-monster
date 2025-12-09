# arachnid-shield-sdk

A Typescript SDK for the [Arachnid Shield API](https://shield.projectarachnid.com) for scanning media for <abbr title="Child Sexual Abuse Material">CSAM</abbr> and other known classified media that is harmful to children.

## Installation

```sh
npm install arachnid-shield-sdk
```

## Usage


### Scanning Media from file

When you have media stored on disk and you wish to scan the contents, you may use `scanMediaFromFile`:

```ts
const { ArachnidShield } = require('arachnid-shield-sdk');
const fs = require('fs');

const shield = new ArachnidShield(
    process.env.ARACHNID_SHIELD_USERNAME,
    process.env.ARACHNID_SHIELD_PASSWORD
);
const filepath = 'path/to/image.jpg';
const { status, data } = await shield.scanMediaFromFile(filepath);
if (status === 'err') {
    console.error(`Failed to scan media: ${data.detail}`);
} else {
    console.log(data);
  /** prints the following 'ScannedMedia' object
   * {
   *    sha1_base32: '3I42H3S6NNFQ2MSVX7XZKYAYSCX5QBYJ',
   *    sha256_hex: 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
   *    classification: 'csam',
   *    match_type: 'near',
   *    size_bytes: 15021,
   *    is_match: true,
   *    near_match_details: [
   *      {
   *        sha1_base32: '2EX6UOOSR62537YDS2THNVNB7FOC74CY',
   *        sha256_hex: '8C3B43FB9BA63B7120CEDF87BC9F348BBAAF5D39A97266D0C7587B5EFD6ABA2D',
   *        classification: 'csam',
   *        timestamp: 3409
   *      },
   *    ]
   * }
   */
}
```

### Scanning Media from bytes

When you have media loaded in memory as bytes, and you wish to scan its contents, you may use `scanMediaFromBytes`:

```ts
const { ArachnidShield } = require('arachnid-shield-sdk');
const fs = require('fs');

const shield = new ArachnidShield(
    process.env.ARACHNID_SHIELD_USERNAME,
    process.env.ARACHNID_SHIELD_PASSWORD
);

const filepath = 'path/to/image.jpg';
const { status, data } = await shield.scanMediaFromBytes(
    fs.readFileSync(filepath), 
    'image/jpeg'
);
if (status === 'err') {
    console.error(`Failed to scan media: ${data.detail}`);
} else {
  console.log(data);
  /** prints the following 'ScannedMedia' object
   * {
   *    sha1_base32: 'TTY4MGOMVNR5KI2ZZ62EMYDZALUTBOHN',
   *    sha256_hex: '8C3B43FB9BA63B7120CEDF87BC9F348BBAAF5D39A97266D0C7587B5EFD6ABA2D',
   *    classification: 'harmful-abusive-material',
   *    match_type: 'exact',
   *    size_bytes: 32301,
   *    is_match: true,
   *    near_match_details: [
   *      {
   *        sha1_base32: 'TTY4MGOMVNR5KI2ZZ62EMYDZALUTBOHN',
   *        sha256_hex: '8C3B43FB9BA63B7120CEDF87BC9F348BBAAF5D39A97266D0C7587B5EFD6ABA2D',
   *        classification: 'harmful-abusive-material',
   *        timestamp: 543
   *      },
   *    ]
   * }
   */
}
```

### Scanning Media from URL

When you are hosting media on a url you own, and you wish to scan its contents, you may use `scanMediaFromUrl`:

```ts
const { ArachnidShield } = require('arachnid-shield-sdk');

const shield = new ArachnidShield(
    process.env.ARACHNID_SHIELD_USERNAME,
    process.env.ARACHNID_SHIELD_PASSWORD
);

const { status, data } = await shield.scanMediaFromUrl(
    "https://your-site/some/media.jpeg"
);
if (status === 'err') {
    console.error(`Failed to scan media: ${data.detail}`);
} else {
    console.log(data);
  /** prints the following 'ScannedMedia' object
   * {
   *    sha1_base32: 'TTY4MGOMVNR5KI2ZZ62EMYDZALUTBOHN',
   *    sha256_hex: '8C3B43FB9BA63B7120CEDF87BC9F348BBAAF5D39A97266D0C7587B5EFD6ABA2D',
   *    classification: 'no-known-match',
   *    match_type: null,
   *    size_bytes: 24335,
   *    is_match: false,
   *    near_match_details: []
   * }
   */
}
```

### Scanning Media via its PDQ hashes.

When you wish to scan (base64 encoded) PDQ hashes of your media, you may use `scanPdqHashes`:

```ts
const { ArachnidShield } = require('arachnid-shield-sdk');

const shield = new ArachnidShield(
    process.env.ARACHNID_SHIELD_USERNAME,
    process.env.ARACHNID_SHIELD_PASSWORD
);

const { status, data } = await shield.scanPdqHashes(
    [
        'd3+tR0vUErJFQH/yMdZ7+w0cGre0fUP0ShMwWbLFLWM='
    ]
);
if (status === 'err') {
    console.error(`Failed to scan media: ${data.detail}`);
} else {
  console.log(data);
  /** prints the following 'ScannedPdqHashes' object
   * {
   *    'scanned_hashes':
   *    {
   *      'd3+tR0vUErJFQH/yMdZ7+w0cGre0fUP0ShMwWbLFLWM=':
   *      {
   *        classification: 'csam',
   *        match_type: 'near',
   *        near_match_details:
   *        {
   *          sha1_base32: 'RDZ6TZNFYKLH4JK22I45TKVIDT4ODUGY',
   *          sha256_hex: '3A5F4737FF776861AFCA281699A848CD0771F5C21BA88AD6CAB5C065C6175703',
   *          classification: 'csam',
   *          timestamp: 0
   *        }
   *      }
   *    }
   * }   
   */
}
```

## Contributing

We don't currently accept contributions but feel free to create an issue if you believe something is broken and needs to be fixed.
