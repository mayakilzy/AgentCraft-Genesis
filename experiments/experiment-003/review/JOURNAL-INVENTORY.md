# Experiment 003 — Development Fallback Journal Inventory

- Mission: `experiment-003-20261005T231628`
- Journal: `experiments/experiment-003/evidence/dev-fallback-journal/`
- Deterministic: every field below is derived from the committed request/response files and the flight record (no hand-written rows).
- The original files are the authoritative evidence; this inventory is a navigation aid, not a replacement.

## Totals

- Requests: **25**
- Responses: **25**
- Main worker calls: **20**
- Handoff calls: **5**
- Reviewer calls: **0**

## Interactions

| # | requested at (UTC) | worker id | identity / role | kind | tier | action | req file | req sha-256 | resp file | resp sha-256 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-05T23:16:32.222Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `run_command` | `done-req-0001.json` | `c13fc87c2f917b19…` | `done-resp-0001.txt` | `634ab8499ded706e…` |
| 2 | 2026-10-05T23:17:42.502Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `run_command` | `done-req-0002.json` | `460b552ef6ab3914…` | `done-resp-0002.txt` | `cd096563eedd061f…` |
| 3 | 2026-10-05T23:17:58.758Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `run_command` | `done-req-0003.json` | `0b8389457b9ff637…` | `done-resp-0003.txt` | `7331c05970fe0266…` |
| 4 | 2026-10-05T23:18:29.992Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `write_file` | `done-req-0004.json` | `f065e3c391228a1f…` | `done-resp-0004.txt` | `668596d6947c9cd0…` |
| 5 | 2026-10-05T23:19:02.255Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `run_command` | `done-req-0005.json` | `dca3efbbe6e769f4…` | `done-resp-0005.txt` | `7777bf3df7b24380…` |
| 6 | 2026-10-05T23:19:10.659Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `run_command` | `done-req-0006.json` | `8bca369832d4176b…` | `done-resp-0006.txt` | `7f82c3e716eb05f0…` |
| 7 | 2026-10-05T23:19:20.924Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | main | cheap | `finish` | `done-req-0007.json` | `4c69bb3829e493de…` | `done-resp-0007.txt` | `0d6acd3440b5bbdb…` |
| 8 | 2026-10-05T23:19:37.179Z | `report-writer-2` | Report Writer / Report Writer | main | default | `read_file` | `done-req-0008.json` | `33bf262b5de203c0…` | `done-resp-0008.txt` | `21dd7ccdf89fdc53…` |
| 9 | 2026-10-05T23:19:57.443Z | `report-writer-2` | Report Writer / Report Writer | main | default | `read_file` | `done-req-0009.json` | `f92a074f2507d2d0…` | `done-resp-0009.txt` | `6933bdea5d5ca3e0…` |
| 10 | 2026-10-05T23:20:05.696Z | `report-writer-2` | Report Writer / Report Writer | main | default | `ask_worker` | `done-req-0010.json` | `fb6cd50416f2ea34…` | `done-resp-0010.txt` | `1a57b580bb85cebd…` |
| 11 | 2026-10-05T23:20:17.948Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | handoff (from report-writer-2) | cheap | `run_command` | `done-req-0011.json` | `7e585d42300789c2…` | `done-resp-0011.txt` | `0678a4fa92e60464…` |
| 12 | 2026-10-05T23:20:30.295Z | `reproduction-engineer-1` | Reproduction Engineer / Reproduction Engineer | handoff (from report-writer-2) | cheap | `finish` | `done-req-0012.json` | `4d51bc86b4130d24…` | `done-resp-0012.txt` | `a917fe58f0d13d47…` |
| 13 | 2026-10-05T23:20:44.548Z | `report-writer-2` | Report Writer / Report Writer | main | default | `ask_worker` | `done-req-0013.json` | `5da758844505cc4c…` | `done-resp-0013.txt` | `47922ddaa49f387a…` |
| 14 | 2026-10-05T23:20:58.800Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | handoff (from report-writer-2) | cheap | `run_command` | `done-req-0014.json` | `bac588724e0db47e…` | `done-resp-0014.txt` | `a62800016588e63f…` |
| 15 | 2026-10-05T23:21:09.063Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | handoff (from report-writer-2) | cheap | `run_command` | `done-req-0015.json` | `a6b2ee55c8030f1f…` | `done-resp-0015.txt` | `752a718637b07e67…` |
| 16 | 2026-10-05T23:21:31.390Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | handoff (from report-writer-2) | cheap | `finish` | `done-req-0016.json` | `8e6e67b252bce7b5…` | `done-resp-0016.txt` | `b00c1c26d37f88e0…` |
| 17 | 2026-10-05T23:21:55.643Z | `report-writer-2` | Report Writer / Report Writer | main | default | `read_file` | `done-req-0017.json` | `8eed0e9675999bb7…` | `done-resp-0017.txt` | `0a72e02c26f9206f…` |
| 18 | 2026-10-05T23:22:07.896Z | `report-writer-2` | Report Writer / Report Writer | main | default | `write_file` | `done-req-0018.json` | `2b18c326f83d3652…` | `done-resp-0018.txt` | `9c398684396c8b76…` |
| 19 | 2026-10-05T23:23:28.173Z | `report-writer-2` | Report Writer / Report Writer | main | default | `finish` | `done-req-0019.json` | `7cc39da3877e7448…` | `done-resp-0019.txt` | `423a841612f392d7…` |
| 20 | 2026-10-05T23:23:46.427Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | main | cheap | `run_command` | `done-req-0020.json` | `a1a44166d12c2fb6…` | `done-resp-0020.txt` | `019d7c84ce46c027…` |
| 21 | 2026-10-05T23:24:18.719Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | main | cheap | `run_command` | `done-req-0021.json` | `093574b5c6c4ad04…` | `done-resp-0021.txt` | `c88c29b98c1db11a…` |
| 22 | 2026-10-05T23:24:30.681Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | main | cheap | `run_command` | `done-req-0022.json` | `02f51b67c0266ca2…` | `done-resp-0022.txt` | `5ac18ed434dd0bc3…` |
| 23 | 2026-10-05T23:26:07.012Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | main | cheap | `run_command` | `done-req-0023.json` | `7639b6ff3bec430f…` | `done-resp-0023.txt` | `ef2359d058bd31cf…` |
| 24 | 2026-10-05T23:26:45.279Z | `diagnostic-analyst-3` | Diagnostic Analyst / Diagnostic Analyst | main | cheap | `finish` | `done-req-0024.json` | `799a3df534d16966…` | `done-resp-0024.txt` | `0a497ae81f93eeee…` |
| 25 | 2026-10-05T23:26:57.533Z | `mission-coordinator-1` | Mission Coordinator / Mission Coordinator | main | default | `finish` | `done-req-0025.json` | `57aaeeb317d940d9…` | `done-resp-0025.txt` | `607fe6f65f1131f8…` |

Full SHA-256 digests (copy-ready):

```
01  REQ c13fc87c2f917b196b784065535e5d4e82f0ef2785465ae8ef2480b176d3a47d  done-req-0001.json
01  RSP 634ab8499ded706e5c96d39ec55f304698a9299fccfc21f76597fa5e3103a21b  done-resp-0001.txt
02  REQ 460b552ef6ab39143db0128564d71c3e25915e6033605b5339fa3f809b03859f  done-req-0002.json
02  RSP cd096563eedd061f506572a2dd533125b092e827c7d4cbab6c3c1b48f928f84c  done-resp-0002.txt
03  REQ 0b8389457b9ff637236af0682fdc622e043b979aa30c7baff4e2dbc2ad6e8342  done-req-0003.json
03  RSP 7331c05970fe0266c9007a5264da2f5c8e799a35556f59e473d6a7d6356d1c55  done-resp-0003.txt
04  REQ f065e3c391228a1f375d3ba8fce71f0690175d1a0fa0c89e3d914979ca3daed5  done-req-0004.json
04  RSP 668596d6947c9cd003d1d0cf31f7ba42bac230a632d30049f0a66118a22e7211  done-resp-0004.txt
05  REQ dca3efbbe6e769f45d0abba9a45c99d46f494cd039ef5fff0af9fc3a222164ce  done-req-0005.json
05  RSP 7777bf3df7b24380d52214d3fdda009e468799e4988ff5e3758943a08175e657  done-resp-0005.txt
06  REQ 8bca369832d4176be6192ffbec1bcf943a87d83080aab2909363e4c414b460a2  done-req-0006.json
06  RSP 7f82c3e716eb05f0f0df1fb2f59124c3ccf61ab4af22b4c32a986f1289578d13  done-resp-0006.txt
07  REQ 4c69bb3829e493deb91550e48faf8a1723239c7a1df3e60f00f75bf804a5fdb1  done-req-0007.json
07  RSP 0d6acd3440b5bbdb73d40a5ae66f890bf00d81065a209232c35d3a91440ab0e4  done-resp-0007.txt
08  REQ 33bf262b5de203c0d362dcd01559fe1b2d33420399f6e6e5c37648ecc4e9e79b  done-req-0008.json
08  RSP 21dd7ccdf89fdc532a585aef9896cfdc528f365ea962a918403f1d268575a556  done-resp-0008.txt
09  REQ f92a074f2507d2d090ede5ac9a8e181f1069d60e316cf966459cf66e126e9668  done-req-0009.json
09  RSP 6933bdea5d5ca3e0226ae91716f17fa24e261b09a63726b4c327ec933bd658eb  done-resp-0009.txt
10  REQ fb6cd50416f2ea34e398c4046e70f325e33753aac43e596112cf4b6ec1c19c91  done-req-0010.json
10  RSP 1a57b580bb85cebd61c8f754f428dd5088c5f00fe9838a54b75dfd7565fda2d4  done-resp-0010.txt
11  REQ 7e585d42300789c25db23b93ab11430a3694183b20c543a994fda939a5fa1ea2  done-req-0011.json
11  RSP 0678a4fa92e60464ad06174fa33ab704f83158ff9c151ac8298720aaac5add13  done-resp-0011.txt
12  REQ 4d51bc86b4130d24717500140b89904c4060765b93b58d51c6b2615380b3ca8e  done-req-0012.json
12  RSP a917fe58f0d13d4762b7cbbb7cc880ca6552c83ecec2b87e822f7e0c87e08cba  done-resp-0012.txt
13  REQ 5da758844505cc4c52ae1577e4712613e63c69633292d176a295ac7e3256a98b  done-req-0013.json
13  RSP 47922ddaa49f387abb3704e43bed49eefc40340fc7032a675a6fcc9d2a9f66bf  done-resp-0013.txt
14  REQ bac588724e0db47ee83edf181c5babeaccd5ac6399587f6031b9ffd149c0efca  done-req-0014.json
14  RSP a62800016588e63fdef533c4da46c53e110894eb237f16a740c7c2c8299a4821  done-resp-0014.txt
15  REQ a6b2ee55c8030f1fa3c28022c18ceaac37736739cdf8167ff555db50c76c53e5  done-req-0015.json
15  RSP 752a718637b07e67bbbd4d67dd9edde524945cd629441db962ff5b3c33085a69  done-resp-0015.txt
16  REQ 8e6e67b252bce7b5f5c8dbe3c2d10c10e12aff7361d2e4b82666fb4d521b03ee  done-req-0016.json
16  RSP b00c1c26d37f88e082a84bce22ba84748b001a6dad9d5c9863c11ba142e7876d  done-resp-0016.txt
17  REQ 8eed0e9675999bb7eccfb6e8037102fe9cb59516fbb63a3137cc269d858c8885  done-req-0017.json
17  RSP 0a72e02c26f9206f608bcf2582e1452cefb05dc09ceeacd19342ce9315b741aa  done-resp-0017.txt
18  REQ 2b18c326f83d36526634e31e7bf7a38c1011a69fd39537cb7199df3ad34348bf  done-req-0018.json
18  RSP 9c398684396c8b767dae01f8f760ebfd30d08fe64cb6a94aab0cd4408fe23ff3  done-resp-0018.txt
19  REQ 7cc39da3877e744806f97e1045740d8b295a1b95ea3d8b7f12df646acb94226e  done-req-0019.json
19  RSP 423a841612f392d71ed1bd75fa19793b10ac26573badefe8ada3a0e2e26945d6  done-resp-0019.txt
20  REQ a1a44166d12c2fb6364b29fda9449be487b9300626b985a468964c2fdcea780c  done-req-0020.json
20  RSP 019d7c84ce46c027923fec4846d5ad668f0061a25b849a9f2e2e875f07a40017  done-resp-0020.txt
21  REQ 093574b5c6c4ad0476a5141bcaced0210c0cc2a81b8ef83d38fa260e87ca0623  done-req-0021.json
21  RSP c88c29b98c1db11a73a029da1614b1dd72099ea766850079afb41d4202e03c06  done-resp-0021.txt
22  REQ 02f51b67c0266ca223092ece23c18913958bad28e2324a1ad42ea53fab8895a9  done-req-0022.json
22  RSP 5ac18ed434dd0bc379f94f8658a74ff6ab8439a431857fd5790adc7e9751f8e9  done-resp-0022.txt
23  REQ 7639b6ff3bec430f3e3950d7c136a95f133f504e6c277b08e7649696e7507a13  done-req-0023.json
23  RSP ef2359d058bd31cf4fa74b525bfe3ea04c7e04b99fe75c354d008072a1747ae8  done-resp-0023.txt
24  REQ 799a3df534d16966d49e0aefbe40a6162e5f5e5f64d8d1d2cb42f39d5a4a8640  done-req-0024.json
24  RSP 0a497ae81f93eeee3470ea6e49c792a026722fc4a11d81b5afaaf522078c89c8  done-resp-0024.txt
25  REQ 57aaeeb317d940d918add9ab01bde37c434c9f5377dad52b630240e90177dc1a  done-req-0025.json
25  RSP 607fe6f65f1131f80d6d2512afc8324b1f87957dc34a0e52adcbcdd78d557396  done-resp-0025.txt
```
