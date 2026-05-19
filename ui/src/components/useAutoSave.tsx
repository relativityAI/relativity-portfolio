
// https://darius-marlowe.medium.com/smarter-forms-in-react-building-a-useautosave-hook-with-debounce-and-react-query-d4d7f9bb052e

import { useEffect, useState, useRef } from 'react';
import axios from 'axios';

export default function useAutoSave(
    data: any,
    url: string,
    delay = 1000
) {
    // console.log(data)

    const prevData = useRef(data)

    const [hasDataChanged, setHasDataChanged] = useState(false)

    useEffect(() => {
        if (prevData.current != data) {
            prevData.current = data
            setHasDataChanged(true)
        }
    }, [data])

    useEffect(() => {
        if (hasDataChanged) {
            const handler = setTimeout(() => {
                console.log("Saving Profile...")
                // console.log(data)
               axios.post(
                    url,
                    data
                )
                    .then(function (response) {
                        // console.log(response);
                    })
                    .catch(function (error) {
                        // console.log(error);
                    });

            }, delay);
            return () => clearTimeout(handler);
        }

    }, [data, delay]);

};

