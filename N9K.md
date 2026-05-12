# Current Nexus 9300 Spines switches by Focus according to roadmap 
## 100G Switches
- N9K-C9364C-H1
	- 64p 100G
	- ACI Leaf capable
	- ACI SPine capable
- N9K-C93600CD-GX
	- 28p 100G + 8p 400G
	- ACI Leaf Capable
	- ACI Spine Capable (data sheet table 3)
- N9336C-SE1
	- 36p 100G
- N9324C-SE1U (Smart switch)
	- 24x 100G
	- Integrated 800G DPU FW
	- ACI support is for Zone-Based Firewall or DCI , not ACI Leaf
	
## 400G Switches
- N9K-C9364D-GX2A
	- 64p 400G
	- RoCEv2
	- HPC
	- AI/ML
	- ACI Spine capable
	- ACI Leaf capable
- N9K-C9348D-GX2A
	- 48p 400G
	- RoCEv2
	- HPC
	- AI/ML
	- macsec capable
	- ACI Spine capable
	- ACI Leaf capable
- N9K-C9332D-GX2B
	- 32p 400G
	- RoCEv2
	- HPC
	- AI/ML
	- ACI Spine capable
	- ACI Leaf capable
- N9K-C9332D-H2R
	- 32p 400G
	- Deep Buffer
	- 80MB On-die buffer
	- macsec capable
	- ACI Leaf Capable
	- ACI Spine Capable (MODE-ACI-SPINE available during ordering)
- N9K-C9316D-GX
	- 16p 400G
	- ACI Leaf Capable
	- ACI Spine Capable (data sheet table 3)
	
## 800G Switches
- N9364E-SP2R-O
	- 64p 800G  OSFP
	- 2RU
	- Not orderable until 2H CY26
- N9364E-SP2R-Q
	- 64p 800G  QSFP-DD
	- 2RU
	- Not orderable until 1H CY27

# Current Nexus 9300 Leaf switches by Focus according to roadmap
## 10G/25G/50G w/ 100G/400G Uplink
- N9396Y12C-SE1
	- 96x 25G + 12x 100G
- N9396T12C-SE1
	- 96x 10GT + 12x 100G
- N9K-C93400LD-H1
	- 48x 10/25/50G SFP56 + 4x 400G QSFP-DD
	- ACI Leaf capable
- N9348Y2C6D-SE1U
	- 48x 25G + 2x 100G + 6x 400G
	- ACI support is for Zone-Based Firewall or DCI , not ACI Leaf
	- Integrated 800G DPU FW
- N9K-C93180YC-FX3
	- 48x 25G + 6 100G
	- ACI Leaf capable
- N9K-C93108TC-FX3
	- 48x  100M/1/10GT + 6x 40/100G QSFP28
	- ACI Leaf capable
- 9348GC-FX3
	- 48x  10M/100M/1GT + 4x1/10/25G + 2x 40/100G
	- ACI Leaf Capable


## 100G w/ 100G/400G Uplink
- N9K-C93600CD-GX
	- 28x 100G + 8x 400G
- N9336C-SE1
	- 36x 100G
- N9324C-SE1U (Smart Switch)
	- 24x 100G
	- ACI support is for Zone-Based Firewall or DCI , not ACI Leaf
	- Integrated 800G DPU FW
- N9K-C9336C-FX2
 	- 36x 100G

## 400G down/uplink
- N9K-C9332D-GX2B
	- 32x 400G
	- RoCEv2
	- HPC
	- AI/ML
	- ACI Spine capable
	- ACI Leaf capable
- N9K-C9316D-GX
	- 16X 400G

# Other Nexus Switches 
- 9348GC-FX3
	- 48p 1G + 4p 25G + 2p 100G
	- will be replaced by 9248G4Y-SA1 in near future (48p 1G + 4p 25G)
- N3K-C3548P-XL
	- 480Gbps w/ 48x 10G
	- 10G port-speed @240ns
	- Ultra Low Latency switch
- 93108TC-FX3P
	- POE ports
	- 48p 100M/1G/2.5G/5G/10GT + 6p 40/100G
	- ACI Leaf Capable
- 9348GC-FX3PH
	- POE ports
	- 40p 10M/100M/1GT + 8p **Half Duplex** 10M/100M 
	- although this is an FX3, it is not ACI capable	

	

# Current Nexus 9300 Spines switches by Focus according to roadmap (NX-OS, no ACI support)
## 800G Switches
- N9364E-SG2-O
	- 64p 800G  OSFP
	- 2RU
	- Spectrum-X capable
	- 256MB fully shared Packet Buffer
	- RoCEv2
	- HPC
	- AI/ML
- N9364E-SG2-Q
	- 64p 800G QSFP-DD
	- 2RU
	- Spectrum-X capable
	- 256MB fully shared Packet Buffer
	- RoCEv2
	- HPC
	- AI/ML
- N9164E-NS4-O
	- 64p 800G OSFP
	- 2RU
	- Nvidia Spectrum-4 ASIC
	- NX-OS , SONiC, or Hyperfabric Operating systems
	- RoCEv2
	- HPC
	- AI/ML
	
# QDD-400G-BD 400G/100G optic supported switches
== important: filter in TMG matrix by QSFP-DD , not by 400G ==
- N9K-C93600CD-GX
- N9K-C9316D-GX
- N9K-C9332D-GX2B
- N9K-C9348D-GX2A
- N9K-C9364D-GX2A
- N9K-C9332D-H2R
QDD-400G-BD support with ACI is planned for late Q4CY2026 (93400LD-H1)
- QSFP-100G-SR1.2 is compatible with QDD-400G-BD
# Alternative to QDD-400G-BD
- QDD-400-AOCxM


# ASIC Features
## SG2 (G200)
- Silicon One
- AI Scale-Up
- AI Scale-Out
- AI Front-end and Back-end
- Low Latency, High PPS, High Radix
- 51.2T Capacity
- 512 x 100G Serdes
- Intelligent Packet Flow
- Intelligent Collective Networking
- Integrated Root-of-Trust on every port
- Does NOT SUPPORT ACI

## E100 (SE1 & SE1U)
- Enterprise Data Center Leaf 
- Enterprise Data Cneter Top of Rack
- Does NOT SUPPORT ACI
- MACsec & IPSEC
- DPU Ready
- 4.8T w/ 56G Serdes