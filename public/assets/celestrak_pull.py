#!/usr/bin/env python
# coding: utf-8

# In[1]:


import json
import requests

PULL_FILENAME = 'celestrak_sat_elem.txt'
FILTER_FILENAME = PULL_FILENAME

tle_urls = ['https://www.celestrak.com/NORAD/elements/active.txt',
            'https://www.celestrak.com/NORAD/elements/weather.txt',
            'https://www.celestrak.com/NORAD/elements/resource.txt',
            'https://www.celestrak.com/NORAD/elements/cubesat.txt',
            'https://www.celestrak.com/NORAD/elements/stations.txt',
            'https://www.celestrak.com/NORAD/elements/sarsat.txt',
            'https://www.celestrak.com/NORAD/elements/noaa.txt',
            'https://www.celestrak.com/NORAD/elements/amateur.txt',
            'https://www.celestrak.com/NORAD/elements/engineering.txt']

tle_urls = ['https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=sarsat&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=noaa&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle',
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=engineering&FORMAT=tle']


def download_tle():

    with open(PULL_FILENAME, 'w') as f:
    
        for url in tle_urls:
            request = requests.get(url)
            f.write(request.text)



# In[2]:


print('[+] Downloading TLE data...')
download_tle()


# In[3]:


def read_tles(file_path):
    """
    Reads the TLE file and returns a list of TLE sets.
    Each TLE set consists of three lines: name, line1, and line2.
    """
    tles = []
    try:
        with open(file_path, 'r') as file:
            lines = file.readlines()

        # Ensure the number of lines is a multiple of 3
        if len(lines) % 3 != 0:
            raise ValueError("Invalid TLE format. The input file should have sets of 3 lines.")
        
        # Collect TLE sets
        for i in range(0, len(lines), 3):
            name, line1, line2 = lines[i].strip(), lines[i+1].strip(), lines[i+2].strip()
            
            # Validate basic structure of the TLE
            if name and line1.startswith("1 ") and line2.startswith("2 "):
                tles.append((name, line1, line2))
            else:
                print(f"Skipping malformed TLE: {name}")
        
    except Exception as e:
        print(f"Error reading file: {e}")
    
    return tles

def filter_duplicates_by_name(tles):
    """
    Filters out duplicate TLEs by checking uniqueness of satellite name.
    Returns a list of unique TLE sets.
    """
    unique_tles = []
    seen_names = set()
    
    for tle in tles:
        name, line1, line2 = tle
        if name not in seen_names:
            unique_tles.append(tle)
            seen_names.add(name)
        else:
            print(f"Duplicate found: {name}")
    
    return unique_tles

def write_tles(tles, output_file):
    """
    Writes the filtered TLE sets to a new file.
    """
    try:
        with open(output_file, 'w') as file:
            for tle in tles:
                file.write(f"{tle[0]}\n{tle[1]}\n{tle[2]}\n")
        print(f"Filtered TLEs written to {output_file}")
    except Exception as e:
        print(f"Error writing to file: {e}")

def filter_tles(input_file, output_file):
    """
    Full process to filter duplicates from a TLE file by name.
    """
    tles = read_tles(input_file)
    if tles:
        unique_tles = filter_duplicates_by_name(tles)
        write_tles(unique_tles, output_file)
    else:
        print("No valid TLEs found in the input file.")


# In[4]:


filter_tles(PULL_FILENAME, FILTER_FILENAME)


# In[ ]:




